import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { StockMovementSource, StockMovementType } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

/** Saídas de estoque que não são venda (avaria, perda, consumo interno, amostras…). */
@Controller('stock-exits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockExitsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Post()
  @Roles('admin', 'manager')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      variantId: string;
      locationId: string;
      quantity: number;
      /** Obrigatório — classificação da saída (ex.: Avaria, Perda) */
      reason: string;
      reference?: string | null;
    },
  ) {
    const reason = (body.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException('Informe o motivo da saída');
    }
    const qtyNum = Number(body.quantity);
    if (Number.isNaN(qtyNum) || qtyNum <= 0) {
      throw new BadRequestException('Quantidade inválida');
    }

    const db = await this.tenantPrisma.getClient(user.tenantSlug);

    return db.$transaction(async (tx) => {
      const bal = await tx.stockBalance.findUnique({
        where: {
          variantId_locationId: { variantId: body.variantId, locationId: body.locationId },
        },
      });
      const current = bal ? Number(bal.quantity) : 0;
      const next = current - qtyNum;
      if (next < 0) {
        throw new BadRequestException('Estoque insuficiente para esta saída');
      }

      await tx.stockBalance.upsert({
        where: {
          variantId_locationId: { variantId: body.variantId, locationId: body.locationId },
        },
        create: {
          variantId: body.variantId,
          locationId: body.locationId,
          quantity: String(next),
        },
        update: { quantity: String(next) },
      });

      return tx.stockMovement.create({
        data: {
          type: StockMovementType.OUT,
          source: StockMovementSource.MANUAL_OUT,
          variantId: body.variantId,
          locationId: body.locationId,
          quantity: String(qtyNum),
          reference: body.reference ?? null,
          outboundReason: reason,
          userId: user.sub,
        },
      });
    });
  }
}
