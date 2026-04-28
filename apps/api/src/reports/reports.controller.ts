import { BadRequestException, Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { StockMovementSource, StockMovementType } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

function replayQty(
  movements: Array<{ type: StockMovementType; quantity: { toString(): string } }>,
): number {
  let bal = 0;
  for (const m of movements) {
    const q = Number(m.quantity);
    if (m.type === StockMovementType.IN) bal += q;
    else if (m.type === StockMovementType.OUT) bal -= q;
    else if (m.type === StockMovementType.ADJUST) bal = q;
  }
  return bal;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get('sales-summary')
  @Roles('admin', 'manager', 'finance')
  async salesSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    const sales = await db.sale.findMany({ where, include: { payments: true } });
    const total = sales.reduce((s, x) => s + Number(x.total), 0);
    return { count: sales.length, total, sales };
  }

  @Get('stock-position')
  @Roles('admin', 'manager', 'seller', 'finance')
  async stock(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.stockBalance.findMany({
      include: {
        variant: { include: { product: true } },
        location: true,
      },
    });
  }

  @Get('stock-daily')
  @Roles('admin', 'manager', 'seller', 'finance')
  async stockDaily(
    @CurrentUser() user: JwtPayload,
    @Query('date') dateStr: string,
    @Query('locationId') locationId?: string,
  ) {
    if (!dateStr) {
      throw new BadRequestException('Parâmetro date é obrigatório (YYYY-MM-DD)');
    }
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const start = new Date(dateStr);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Data inválida');
    }
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);

    const balances = await db.stockBalance.findMany({
      where: locationId ? { locationId } : undefined,
      include: {
        variant: { include: { product: true } },
        location: true,
      },
    });

    const variantLocKeys = new Set(balances.map((b) => `${b.variantId}\t${b.locationId}`));

    const extraMoves = await db.stockMovement.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        ...(locationId ? { locationId } : {}),
      },
      select: { variantId: true, locationId: true },
    });
    for (const m of extraMoves) {
      variantLocKeys.add(`${m.variantId}\t${m.locationId}`);
    }

    const lines: Array<{
      variantId: string;
      sku: string;
      productName: string;
      locationId: string;
      locationCode: string;
      opening: number;
      entriesPurchase: number;
      entriesOther: number;
      exitsSale: number;
      exitsManual: number;
      adjustments: number;
      closing: number;
    }> = [];

    for (const key of variantLocKeys) {
      const [variantId, locId] = key.split('\t');
      const all = await db.stockMovement.findMany({
        where: { variantId, locationId: locId },
        orderBy: { createdAt: 'asc' },
      });

      const opening = replayQty(all.filter((m) => m.createdAt < start));
      const closing = replayQty(all.filter((m) => m.createdAt <= end));

      const dayMs = all.filter((m) => m.createdAt >= start && m.createdAt <= end);
      let entriesPurchase = 0;
      let entriesOther = 0;
      let exitsSale = 0;
      let exitsManual = 0;
      let adjustments = 0;

      for (const m of dayMs) {
        const q = Number(m.quantity);
        if (m.type === StockMovementType.ADJUST) {
          adjustments += 1;
          continue;
        }
        if (m.type === StockMovementType.IN) {
          if (m.source === StockMovementSource.GOODS_RECEIPT) entriesPurchase += q;
          else entriesOther += q;
        } else if (m.type === StockMovementType.OUT) {
          if (m.source === StockMovementSource.SALE) exitsSale += q;
          else if (m.source === StockMovementSource.MANUAL_OUT) exitsManual += q;
        }
      }

      const variant = balances.find((b) => b.variantId === variantId && b.locationId === locId)
        ?.variant ??
        (await db.productVariant.findFirst({
          where: { id: variantId },
          include: { product: true },
        }));
      const location = balances.find((b) => b.variantId === variantId && b.locationId === locId)
        ?.location ??
        (await db.stockLocation.findUnique({ where: { id: locId } }));

      if (!variant || !location) continue;

      lines.push({
        variantId,
        sku: variant.sku,
        productName: variant.product.name,
        locationId: locId,
        locationCode: location.code,
        opening,
        entriesPurchase,
        entriesOther,
        exitsSale,
        exitsManual,
        adjustments,
        closing,
      });
    }

    lines.sort((a, b) => a.productName.localeCompare(b.productName) || a.sku.localeCompare(b.sku));

    return {
      date: dateStr,
      locationId: locationId ?? null,
      note:
        'Saldo inicial e final calculados por replays de todas as movimentações (inclui ajustes absolutos). Entradas NF = GOODS_RECEIPT; saídas venda = SALE; demais saídas manuais = MANUAL_OUT.',
      lines,
    };
  }

  @Get('export/sales.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Roles('admin', 'manager', 'finance')
  async exportSalesCsv(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    const rows = await db.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const data = rows.map((r) => ({
      number: r.number,
      total: r.total,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
    res.send('\uFEFF' + toCsv(data as unknown as Record<string, unknown>[]));
  }
}
