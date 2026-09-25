import { randomUUID } from 'node:crypto';

import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { StockMovementSource, StockMovementType } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { MenuAccessService } from '../users/menu-access.service';

/** Transferência interna entre locais: saída no origem + entrada no destino (mesmo ID de referência). */
@Controller('stock-transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockTransfersController {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly menuAccess: MenuAccessService,
  ) {}

  @Post()
  @Roles('admin', 'manager', 'seller')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      fromLocationId: string;
      toLocationId: string;
      /** Legado: um item por requisição. */
      variantId?: string;
      quantity?: number;
      /** Um ou mais itens na mesma transferência (mesma referência TRF). */
      lines?: Array<{ variantId: string; quantity: number }>;
      notes?: string | null;
      managerPassword?: string;
    },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'create',
      body.managerPassword,
    );
    const fromId = (body.fromLocationId ?? '').trim();
    const toId = (body.toLocationId ?? '').trim();
    if (!fromId || !toId) {
      throw new BadRequestException('Informe local de origem e destino.');
    }
    if (fromId === toId) {
      throw new BadRequestException('Origem e destino devem ser diferentes.');
    }

    type Line = { variantId: string; quantity: number };
    let lines: Line[] = [];
    if (Array.isArray(body.lines) && body.lines.length > 0) {
      lines = body.lines.map((l, i) => {
        const variantId = (l.variantId ?? '').trim();
        const qtyNum = Number(l.quantity);
        if (!variantId) {
          throw new BadRequestException(`Linha ${i + 1}: produto inválido.`);
        }
        if (Number.isNaN(qtyNum) || qtyNum <= 0) {
          throw new BadRequestException(`Linha ${i + 1}: quantidade inválida.`);
        }
        return { variantId, quantity: qtyNum };
      });
    } else if (body.variantId?.trim()) {
      const qtyNum = Number(body.quantity);
      if (Number.isNaN(qtyNum) || qtyNum <= 0) {
        throw new BadRequestException('Quantidade inválida.');
      }
      lines = [{ variantId: body.variantId.trim(), quantity: qtyNum }];
    } else {
      throw new BadRequestException('Informe ao menos um produto na transferência.');
    }

    const merged = new Map<string, number>();
    for (const l of lines) {
      merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.quantity);
    }
    lines = [...merged.entries()].map(([variantId, quantity]) => ({ variantId, quantity }));

    const notes = (body.notes ?? '').trim();
    const db = await this.tenantPrisma.getClient(user.tenantSlug);

    for (const l of lines) {
      const variant = await db.productVariant.findUnique({ where: { id: l.variantId } });
      if (!variant) throw new BadRequestException('Produto / variação não encontrado.');
    }

    const refKey = `TRF:${randomUUID()}`;
    const noteSuffix = notes ? ` — ${notes}` : '';

    return db.$transaction(async (tx) => {
      const [fromLoc, toLoc] = await Promise.all([
        tx.stockLocation.findUnique({ where: { id: fromId } }),
        tx.stockLocation.findUnique({ where: { id: toId } }),
      ]);
      if (!fromLoc) throw new BadRequestException('Local de origem não encontrado.');
      if (!toLoc) throw new BadRequestException('Local de destino não encontrado.');

      const baseRef = `${refKey} | ${fromLoc.code} → ${toLoc.code}${noteSuffix}`;
      const movements: Array<{ variantId: string; outId: string; inId: string; quantity: number }> =
        [];

      for (const line of lines) {
        const qtyNum = line.quantity;
        const bal = await tx.stockBalance.findUnique({
          where: { variantId_locationId: { variantId: line.variantId, locationId: fromId } },
        });
        const currentFrom = bal ? Number(bal.quantity) : 0;
        if (currentFrom + 1e-9 < qtyNum) {
          const ing = await tx.productVariant.findUnique({
            where: { id: line.variantId },
            include: { product: { select: { name: true } } },
          });
          throw new BadRequestException(
            `Estoque insuficiente no origem para "${ing?.product.name ?? line.variantId}" (disp. ${currentFrom}, solicitado ${qtyNum}).`,
          );
        }

        await tx.stockBalance.upsert({
          where: { variantId_locationId: { variantId: line.variantId, locationId: fromId } },
          create: {
            variantId: line.variantId,
            locationId: fromId,
            quantity: String(currentFrom - qtyNum),
          },
          update: { quantity: String(currentFrom - qtyNum) },
        });

        const balTo = await tx.stockBalance.findUnique({
          where: { variantId_locationId: { variantId: line.variantId, locationId: toId } },
        });
        const currentTo = balTo ? Number(balTo.quantity) : 0;

        await tx.stockBalance.upsert({
          where: { variantId_locationId: { variantId: line.variantId, locationId: toId } },
          create: {
            variantId: line.variantId,
            locationId: toId,
            quantity: String(currentTo + qtyNum),
          },
          update: { quantity: String(currentTo + qtyNum) },
        });

        const outMov = await tx.stockMovement.create({
          data: {
            type: StockMovementType.OUT,
            source: StockMovementSource.TRANSFER,
            variantId: line.variantId,
            locationId: fromId,
            quantity: String(qtyNum),
            reference: baseRef,
            userId: user.sub,
          },
        });

        const inMov = await tx.stockMovement.create({
          data: {
            type: StockMovementType.IN,
            source: StockMovementSource.TRANSFER,
            variantId: line.variantId,
            locationId: toId,
            quantity: String(qtyNum),
            unitCost: null,
            reference: baseRef,
            userId: user.sub,
          },
        });

        movements.push({
          variantId: line.variantId,
          outId: outMov.id,
          inId: inMov.id,
          quantity: qtyNum,
        });
      }

      const first = movements[0]!;
      return {
        transferRef: refKey,
        lineCount: movements.length,
        outMovement: { id: first.outId },
        inMovement: { id: first.inId },
        movements,
      };
    });
  }
}
