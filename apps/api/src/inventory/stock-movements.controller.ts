import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { StockMovementSource, StockMovementType } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Controller('stock-movements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockMovementsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('take') take = '50',
    @Query('source') source?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const n = Math.min(200, Math.max(1, parseInt(String(take), 10) || 50));
    const allSources = Object.values(StockMovementSource);
    const where =
      source && allSources.includes(source as StockMovementSource)
        ? { source: source as StockMovementSource }
        : undefined;
    return db.stockMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: n,
      include: { variant: { include: { product: true } }, location: true },
    });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      type: StockMovementType;
      variantId: string;
      locationId: string;
      quantity: string | number;
      unitCost?: string | number | null;
      reference?: string | null;
      outboundReason?: string | null;
    },
  ) {
    if (body.type === StockMovementType.TRANSFER) {
      throw new BadRequestException('Use duas movimentações ou endpoint de transferência (futuro).');
    }

    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const qtyNum = Number(body.quantity);
    if (Number.isNaN(qtyNum)) {
      throw new BadRequestException('Quantidade inválida');
    }

    return db.$transaction(async (tx) => {
      const bal = await tx.stockBalance.findUnique({
        where: {
          variantId_locationId: { variantId: body.variantId, locationId: body.locationId },
        },
      });
      const current = bal ? Number(bal.quantity) : 0;

      let next: number;
      if (body.type === StockMovementType.ADJUST) {
        next = qtyNum;
      } else if (body.type === StockMovementType.IN) {
        next = current + qtyNum;
      } else {
        next = current - qtyNum;
      }

      if (next < 0) {
        throw new BadRequestException('Estoque insuficiente');
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

      const mov = await tx.stockMovement.create({
        data: {
          type: body.type,
          source:
            body.type === StockMovementType.ADJUST
              ? StockMovementSource.ADJUSTMENT
              : body.type === StockMovementType.IN
                ? StockMovementSource.OTHER
                : StockMovementSource.MANUAL_OUT,
          variantId: body.variantId,
          locationId: body.locationId,
          quantity: String(Math.abs(qtyNum)),
          unitCost: body.unitCost != null ? String(body.unitCost) : null,
          reference: body.reference ?? null,
          outboundReason: body.outboundReason ?? null,
          userId: user.sub,
        },
      });

      if (body.type === StockMovementType.IN && body.unitCost != null) {
        const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: body.variantId } });
        const oldCost = Number(variant.costAverage);
        const incoming = qtyNum;
        const unitCost = Number(body.unitCost);
        const denom = current + incoming;
        const newAverage = denom > 0 ? (oldCost * Math.max(current, 0) + unitCost * incoming) / denom : unitCost;
        await tx.productVariant.update({
          where: { id: body.variantId },
          data: { costAverage: String(newAverage) },
        });
      }

      return mov;
    });
  }
}
