import { randomUUID } from 'node:crypto';

import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { StockMovementSource, StockMovementType } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

/** Transferência interna entre locais: saída no origem + entrada no destino (mesmo ID de referência). */
@Controller('stock-transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockTransfersController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Post()
  @Roles('admin', 'manager')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      fromLocationId: string;
      toLocationId: string;
      variantId: string;
      quantity: number;
      notes?: string | null;
    },
  ) {
    const fromId = (body.fromLocationId ?? '').trim();
    const toId = (body.toLocationId ?? '').trim();
    if (!fromId || !toId) {
      throw new BadRequestException('Informe local de origem e destino.');
    }
    if (fromId === toId) {
      throw new BadRequestException('Origem e destino devem ser diferentes.');
    }

    const qtyNum = Number(body.quantity);
    if (Number.isNaN(qtyNum) || qtyNum <= 0) {
      throw new BadRequestException('Quantidade inválida.');
    }

    const notes = (body.notes ?? '').trim();
    const db = await this.tenantPrisma.getClient(user.tenantSlug);

    const variant = await db.productVariant.findUnique({ where: { id: body.variantId } });
    if (!variant) throw new BadRequestException('Produto / variação não encontrado.');

    const refKey = `TRF:${randomUUID()}`;
    const noteSuffix = notes ? ` — ${notes}` : '';

    return db.$transaction(async (tx) => {
      const [fromLoc, toLoc] = await Promise.all([
        tx.stockLocation.findUnique({ where: { id: fromId } }),
        tx.stockLocation.findUnique({ where: { id: toId } }),
      ]);
      if (!fromLoc) throw new BadRequestException('Local de origem não encontrado.');
      if (!toLoc) throw new BadRequestException('Local de destino não encontrado.');

      const bal = await tx.stockBalance.findUnique({
        where: { variantId_locationId: { variantId: body.variantId, locationId: fromId } },
      });
      const currentFrom = bal ? Number(bal.quantity) : 0;
      if (currentFrom < qtyNum) {
        throw new BadRequestException('Estoque insuficiente no local de origem.');
      }

      await tx.stockBalance.upsert({
        where: { variantId_locationId: { variantId: body.variantId, locationId: fromId } },
        create: {
          variantId: body.variantId,
          locationId: fromId,
          quantity: String(currentFrom - qtyNum),
        },
        update: { quantity: String(currentFrom - qtyNum) },
      });

      const balTo = await tx.stockBalance.findUnique({
        where: { variantId_locationId: { variantId: body.variantId, locationId: toId } },
      });
      const currentTo = balTo ? Number(balTo.quantity) : 0;

      await tx.stockBalance.upsert({
        where: { variantId_locationId: { variantId: body.variantId, locationId: toId } },
        create: {
          variantId: body.variantId,
          locationId: toId,
          quantity: String(currentTo + qtyNum),
        },
        update: { quantity: String(currentTo + qtyNum) },
      });

      const baseRef = `${refKey} | ${fromLoc.code} → ${toLoc.code}${noteSuffix}`;

      const outMov = await tx.stockMovement.create({
        data: {
          type: StockMovementType.OUT,
          source: StockMovementSource.TRANSFER,
          variantId: body.variantId,
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
          variantId: body.variantId,
          locationId: toId,
          quantity: String(qtyNum),
          unitCost: null,
          reference: baseRef,
          userId: user.sub,
        },
      });

      return { transferRef: refKey, outMovement: outMov, inMovement: inMov };
    });
  }
}
