import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { Prisma, StockMovementSource, StockMovementType } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Trata `YYYY-MM-DD` como data local (sem deslocamento de fuso UTC). */
function parseQueryDate(raw: string, mode: 'start' | 'end'): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return mode === 'end' ? endOfDay(date) : startOfDay(date);
  }
  return new Date(raw);
}

@Controller('stock-movements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockMovementsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Faixa de números de controle existentes (min/max/count).
   * Usado para pré-popular o modal de impressão.
   */
  @Get('control-range')
  @Roles('admin', 'manager', 'finance')
  async controlRange(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const [min, max, count] = await Promise.all([
      db.stockMovement.findFirst({
        orderBy: { controlNumber: 'asc' },
        select: { controlNumber: true },
      }),
      db.stockMovement.findFirst({
        orderBy: { controlNumber: 'desc' },
        select: { controlNumber: true },
      }),
      db.stockMovement.count(),
    ]);
    return {
      min: min?.controlNumber ?? null,
      max: max?.controlNumber ?? null,
      count,
    };
  }

  /**
   * Painel de estoque: agregados do dia, últimos 7 dias e lançamentos recentes (uma requisição).
   */
  @Get('painel-overview')
  @Roles('admin', 'manager', 'seller', 'finance')
  async painelOverview(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const sevenStart = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));

    const [todayRows, weekRows, recent] = await Promise.all([
      db.stockMovement.findMany({
        where: { createdAt: { gte: todayStart, lte: todayEnd } },
        select: { type: true, source: true, quantity: true },
      }),
      db.stockMovement.findMany({
        where: { createdAt: { gte: sevenStart, lte: todayEnd } },
        select: { type: true, quantity: true },
      }),
      db.stockMovement.findMany({
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: {
          variant: { include: { product: { select: { name: true } } } },
          location: { select: { code: true, name: true } },
          user: { select: { name: true } },
        },
      }),
    ]);

    let todayInQty = 0;
    let todayOutQty = 0;
    let todayAdjustQty = 0;
    const bySource = new Map<
      string,
      { count: number; inQty: number; outQty: number; adjustQty: number }
    >();

    for (const r of todayRows) {
      const q = Number(r.quantity);
      if (r.type === 'IN') todayInQty += q;
      else if (r.type === 'OUT') todayOutQty += q;
      else if (r.type === 'ADJUST') todayAdjustQty += q;

      const k = r.source;
      if (!bySource.has(k)) {
        bySource.set(k, { count: 0, inQty: 0, outQty: 0, adjustQty: 0 });
      }
      const agg = bySource.get(k)!;
      agg.count += 1;
      if (r.type === 'IN') agg.inQty += q;
      else if (r.type === 'OUT') agg.outQty += q;
      else if (r.type === 'ADJUST') agg.adjustQty += q;
    }

    let weekInQty = 0;
    let weekOutQty = 0;
    let weekAdjustQty = 0;
    for (const r of weekRows) {
      const q = Number(r.quantity);
      if (r.type === 'IN') weekInQty += q;
      else if (r.type === 'OUT') weekOutQty += q;
      else if (r.type === 'ADJUST') weekAdjustQty += q;
    }

    const bySourceList = [...bySource.entries()]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.count - a.count);

    return {
      today: {
        movementCount: todayRows.length,
        totalInQty: todayInQty,
        totalOutQty: todayOutQty,
        totalAdjustQty: todayAdjustQty,
        bySource: bySourceList,
      },
      last7Days: {
        movementCount: weekRows.length,
        totalInQty: weekInQty,
        totalOutQty: weekOutQty,
        totalAdjustQty: weekAdjustQty,
      },
      recent: recent.map((m) => ({
        id: m.id,
        controlNumber: m.controlNumber,
        type: m.type,
        source: m.source,
        quantity: m.quantity,
        createdAt: m.createdAt,
        variant: { sku: m.variant.sku, product: { name: m.variant.product.name } },
        location: { code: m.location.code, name: m.location.name },
        userName: m.user?.name ?? null,
      })),
    };
  }

  /**
   * Relatório de movimentos para impressão. Suporta filtros independentes:
   * - `from`/`to`        : recorte por data de criação
   * - `controlFrom`/`To` : recorte por número de controle
   * - `variantId`        : restringe a um produto/variante
   * - `type`             : IN | OUT | ADJUST | TRANSFER
   *
   * Retorna a lista detalhada + agregados (qtd, valor) por tipo.
   */
  @Get('report')
  @Roles('admin', 'manager', 'finance')
  async report(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('controlFrom') controlFromRaw?: string,
    @Query('controlTo') controlToRaw?: string,
    @Query('variantId') variantId?: string,
    @Query('type') typeRaw?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);

    const where: Prisma.StockMovementWhereInput = {};
    const hasControl = Boolean(controlFromRaw || controlToRaw);
    if (hasControl) {
      const control: Prisma.IntFilter<'StockMovement'> = {};
      if (controlFromRaw) control.gte = Number(controlFromRaw);
      if (controlToRaw) control.lte = Number(controlToRaw);
      where.controlNumber = control;
    } else if (fromRaw || toRaw) {
      const date: Prisma.DateTimeFilter<'StockMovement'> = {};
      if (fromRaw) date.gte = parseQueryDate(fromRaw, 'start');
      if (toRaw) date.lte = parseQueryDate(toRaw, 'end');
      where.createdAt = date;
    }
    if (variantId) where.variantId = variantId;
    if (typeRaw && Object.values(StockMovementType).includes(typeRaw as StockMovementType)) {
      where.type = typeRaw as StockMovementType;
    }

    const movements = await db.stockMovement.findMany({
      where,
      orderBy: { controlNumber: 'asc' },
      include: {
        variant: { include: { product: { select: { name: true } } } },
        location: true,
        user: { select: { name: true } },
      },
    });

    let totalIn = 0;
    let totalOut = 0;
    let totalAdjust = 0;
    let valueIn = 0;
    for (const m of movements) {
      const qty = Number(m.quantity);
      const cost = m.unitCost ? Number(m.unitCost) : 0;
      if (m.type === 'IN') {
        totalIn += qty;
        valueIn += qty * cost;
      } else if (m.type === 'OUT') {
        totalOut += qty;
      } else if (m.type === 'ADJUST') {
        totalAdjust += qty;
      }
    }

    return {
      movements: movements.map((m) => ({
        id: m.id,
        controlNumber: m.controlNumber,
        type: m.type,
        source: m.source,
        createdAt: m.createdAt,
        quantity: m.quantity,
        unitCost: m.unitCost,
        reference: m.reference,
        outboundReason: m.outboundReason,
        location: { code: m.location.code, name: m.location.name },
        variant: {
          sku: m.variant.sku,
          barcode: m.variant.barcode,
          product: { name: m.variant.product.name },
        },
        user: m.user?.name ?? null,
      })),
      summary: {
        count: movements.length,
        totalIn,
        totalOut,
        totalAdjust,
        valueIn,
      },
      filters: {
        from: fromRaw ?? null,
        to: toRaw ?? null,
        controlFrom: controlFromRaw ?? null,
        controlTo: controlToRaw ?? null,
        variantId: variantId ?? null,
        type: typeRaw ?? null,
      },
    };
  }

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('take') take = '50',
    @Query('source') source?: string,
    /** `desc` = mais recentes primeiro (ex.: tela de transferências). Padrão: `asc`. */
    @Query('order') order?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const n = Math.min(200, Math.max(1, parseInt(String(take), 10) || 50));
    const allSources = Object.values(StockMovementSource);
    const where =
      source && allSources.includes(source as StockMovementSource)
        ? { source: source as StockMovementSource }
        : undefined;
    const dir = order === 'desc' ? 'desc' : 'asc';
    return db.stockMovement.findMany({
      where,
      orderBy: { createdAt: dir },
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
