import { BadRequestException, Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma, PrismaClient, SaleStatus, StockMovementSource, StockMovementType } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
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
/** `YYYY-MM-DD` como dia local — alinhado ao painel / movimentações. */
function parseReportDate(raw: string, mode: 'start' | 'end'): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return mode === 'end' ? endOfDay(date) : startOfDay(date);
  }
  const date = new Date(raw);
  return mode === 'end' ? endOfDay(date) : startOfDay(date);
}

type StockMovementSnap = {
  type: StockMovementType;
  quantity: Prisma.Decimal;
};

/** Saldo depois da movimentação (mesma convenção dos replays já usados nos relatórios). */
function applyMovement(balBefore: number, m: StockMovementSnap): number {
  const qty = Number(m.quantity);
  if (m.type === StockMovementType.ADJUST) return qty;
  if (m.type === StockMovementType.IN) return balBefore + qty;
  return balBefore - qty;
}

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

type ProductMovementRow = {
  createdAt: string;
  locationCode: string;
  locationName: string;
  controlNumber: number;
  type: string;
  source: string;
  quantityInMove: string;
  balanceBefore: number;
  balanceAfter: number;
  belowMinStock: boolean;
  aboveMaxStock: boolean;
  reference: string | null;
  outboundReason: string | null;
};

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

  /** Limite de linhas SKU no relatório por intervalo evita payloads enormes sem aviso prévio (ajuste sob demanda). */
  private readonly productMovementCadRangeMaxVariants = 2000;

  /** Mantém `Product.inventoryControlMin` igual ao MIN(`minStock` das variantes) — corrige dados importados/fora do PATCH. */
  private async reconcileProductInventoryControlMins(db: PrismaClient) {
    await db.$executeRaw`
      UPDATE "Product" AS p
      SET "inventoryControlMin" = v.min_agg
      FROM (
        SELECT "productId", MIN("minStock") AS min_agg
        FROM "ProductVariant"
        GROUP BY "productId"
      ) AS v
      WHERE p.id = v."productId"
    `;
  }

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
  async stock(
    @CurrentUser() user: JwtPayload,
    @Query('maxStockCeiling') maxStockCeilingRaw?: string,
    @Query('useMinControl') useMinControl?: string,
    @Query('useMaxControl') useMaxControl?: string,
    @Query('alertsOnly') alertsOnly?: string,
  ) {
    const useMin = useMinControl === '1' || useMinControl === 'true';
    const useMax = useMaxControl === '1' || useMaxControl === 'true';
    const onlyAlerts = alertsOnly === '1' || alertsOnly === 'true';
    let maxCeiling: number | null = null;
    if (maxStockCeilingRaw != null && String(maxStockCeilingRaw).trim() !== '') {
      maxCeiling = Number(String(maxStockCeilingRaw).replace(',', '.'));
      if (Number.isNaN(maxCeiling) || maxCeiling < 0) {
        throw new BadRequestException('Teto de estoque (máximo) inválido.');
      }
    }
    if (useMax && maxCeiling == null) {
      throw new BadRequestException('Informe o teto de estoque ao usar controle máximo.');
    }
    if (onlyAlerts && !useMin && !(useMax && maxCeiling != null)) {
      throw new BadRequestException(
        'Para listar somente alertas de estoque, ative o controle mínimo e/ou o máximo com teto informado.',
      );
    }

    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const balances = await db.stockBalance.findMany({
      include: {
        variant: { include: { product: true } },
        location: true,
      },
    });

    const totalByVariant = new Map<string, number>();
    for (const b of balances) {
      const q = Number(b.quantity);
      totalByVariant.set(b.variantId, (totalByVariant.get(b.variantId) ?? 0) + q);
    }

    const EPS = 1e-9;
    const variantFlags = (variantId: string, minS: number) => {
      const onHand = totalByVariant.get(variantId) ?? 0;
      return {
        stockOnHandTotal: onHand,
        minStock: minS,
        belowMinStock: useMin && onHand + EPS < minS,
        aboveMaxStock: useMax && maxCeiling != null && onHand > maxCeiling + EPS,
      };
    };

    let rows = balances.map((b) => {
      const minS = Number(b.variant.minStock);
      const f = variantFlags(b.variantId, minS);
      return {
        variantId: b.variantId,
        locationId: b.locationId,
        quantity: b.quantity?.toString() ?? String(b.quantity),
        variant: b.variant,
        location: b.location,
        ...f,
      };
    });

    if (onlyAlerts) {
      rows = rows.filter((r) => r.belowMinStock || r.aboveMaxStock);
    }

    const note =
      'Por local: cada linha é um saldo. Comparações de mínimo e teto usam o estoque total da variante (soma em todos os locais), repetido nas linhas da mesma variação.';

    return {
      title: 'Posição de estoque',
      options: {
        useMinControl: useMin,
        useMaxControl: useMax,
        maxStockCeiling: maxCeiling,
        alertsOnly: onlyAlerts,
      },
      note,
      rows,
    };
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

  /**
   * Monta linhas do relatório de movimentação para uma única variação (todas no período; filtro \"somente alertas\" é aplicado depois).
   */
  private async computeProductMovementRows(
    db: PrismaClient,
    vid: string,
    variantMinStock: number,
    periodStart: Date,
    periodEnd: Date,
    locationId: string | undefined,
    useMin: boolean,
    useMax: boolean,
    maxCeiling: number | null,
  ): Promise<ProductMovementRow[]> {
    const baseWherePre: Prisma.StockMovementWhereInput = {
      variantId: vid,
      createdAt: { lt: periodStart },
    };
    if (locationId) baseWherePre.locationId = locationId;

    const preMoves = await db.stockMovement.findMany({
      where: baseWherePre,
      orderBy: [{ locationId: 'asc' }, { createdAt: 'asc' }, { controlNumber: 'asc' }],
      select: { locationId: true, type: true, quantity: true },
    });

    const baseWhereWin: Prisma.StockMovementWhereInput = {
      variantId: vid,
      createdAt: { gte: periodStart, lte: periodEnd },
    };
    if (locationId) baseWhereWin.locationId = locationId;

    const windowMoves = await db.stockMovement.findMany({
      where: baseWhereWin,
      orderBy: [{ createdAt: 'asc' }, { controlNumber: 'asc' }],
      include: { location: { select: { id: true, code: true, name: true } } },
    });

    const locIds = new Set<string>();
    for (const m of preMoves) locIds.add(m.locationId);
    for (const m of windowMoves) locIds.add(m.locationId);

    const openingByLoc = new Map<string, number>();
    for (const lid of locIds) {
      const seq = preMoves.filter((x) => x.locationId === lid);
      openingByLoc.set(lid, replayQty(seq));
    }

    const rows: ProductMovementRow[] = [];

    for (const lid of [...locIds].sort()) {
      const locMoves = windowMoves.filter((m) => m.locationId === lid);
      let running = openingByLoc.get(lid) ?? 0;
      for (const m of locMoves) {
        const before = running;
        const after = applyMovement(before, m);
        const belowMin = useMin && after < variantMinStock - 1e-9;
        const aboveMax = useMax && maxCeiling != null && after > maxCeiling + 1e-9;
        rows.push({
          createdAt: m.createdAt.toISOString(),
          locationCode: m.location.code,
          locationName: m.location.name,
          controlNumber: m.controlNumber,
          type: m.type,
          source: m.source,
          quantityInMove: String(m.quantity),
          balanceBefore: before,
          balanceAfter: after,
          belowMinStock: belowMin,
          aboveMaxStock: aboveMax,
          reference: m.reference,
          outboundReason: m.outboundReason,
        });
        running = after;
      }
    }

    rows.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.controlNumber - b.controlNumber,
    );

    return rows;
  }

  /**
   * Movimentação de produtos: uma variação (`variantId`) ou todas as variantes dos produtos cujo **controle de estoque
   * no cadastro** (`Product.inventoryControlMin`, igual ao menor `minStock` entre variantes) estiver entre
   * `minStockCadFrom` e `minStockCadTo`.
   *
   * `showNoMovement`: quando verdadeiro, mantém variações sem nenhuma movimentação na janela (tabela vazia).
   *
   * Em cada cenário há opção de teto de estoque (máximo) e filtro por alertas após cada movimento.
   */
  @Get('product-movements')
  @Roles('admin', 'manager', 'seller', 'finance')
  async productMovements(
    @CurrentUser() user: JwtPayload,
    @Query('variantId') variantIdRaw?: string,
    @Query('minStockCadFrom') minStockCadFromRaw?: string,
    @Query('minStockCadTo') minStockCadToRaw?: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('locationId') locationId?: string,
    @Query('maxStockCeiling') maxStockCeilingRaw?: string,
    @Query('useMinControl') useMinControl?: string,
    @Query('useMaxControl') useMaxControl?: string,
    @Query('alertsOnly') alertsOnly?: string,
    @Query('showNoMovement') showNoMovementRaw?: string,
  ) {
    if (!fromRaw || !toRaw) throw new BadRequestException('Informe from e to (YYYY-MM-DD).');

    const periodStart = parseReportDate(fromRaw, 'start');
    const periodEnd = parseReportDate(toRaw, 'end');
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException('Período inválido: data final anterior à inicial.');
    }

    const useMin = useMinControl === '1' || useMinControl === 'true';
    const useMax = useMaxControl === '1' || useMaxControl === 'true';
    const onlyAlerts = alertsOnly === '1' || alertsOnly === 'true';
    const showNoMovement = showNoMovementRaw === '1' || showNoMovementRaw === 'true';
    let maxCeiling: number | null = null;
    if (maxStockCeilingRaw != null && String(maxStockCeilingRaw).trim() !== '') {
      maxCeiling = Number(String(maxStockCeilingRaw).replace(',', '.'));
      if (Number.isNaN(maxCeiling) || maxCeiling < 0) {
        throw new BadRequestException('Teto de estoque (máximo) inválido.');
      }
    }
    if (useMax && maxCeiling == null) {
      throw new BadRequestException('Informe o teto de estoque ao usar controle máximo.');
    }
    if (onlyAlerts && !useMin && !(useMax && maxCeiling != null)) {
      throw new BadRequestException(
        'Para listar somente alertas, ative o controle mínimo e/ou o máximo com teto informado.',
      );
    }

    const trimmedVid = (variantIdRaw ?? '').trim();
    let cadastroMinStockInterval: { from: number; to: number } | null = null;

    const db = await this.tenantPrisma.getClient(user.tenantSlug);

    let variants: Array<{
      id: string;
      sku: string;
      minStock: Prisma.Decimal;
      product: { id: string; name: string; inventoryControlMin: Prisma.Decimal };
    }>;

    if (trimmedVid) {
      const v = await db.productVariant.findUnique({
        where: { id: trimmedVid },
        include: {
          product: { select: { id: true, name: true, inventoryControlMin: true } },
        },
      });
      if (!v) throw new BadRequestException('Variação não encontrada.');
      variants = [v];
    } else {
      const fromTxt = String(minStockCadFromRaw ?? '').trim();
      const toTxt = String(minStockCadToRaw ?? '').trim();
      if (!fromTxt || !toTxt) {
        throw new BadRequestException(
          'Informe variantId de uma variação ou ambos os parâmetros minStockCadFrom e minStockCadTo (intervalo do controle de estoque do produto no cadastro — menor mínimo entre variantes).',
        );
      }
      const cadMin = Number(fromTxt.replace(',', '.'));
      const cadMax = Number(toTxt.replace(',', '.'));
      if (Number.isNaN(cadMin) || Number.isNaN(cadMax)) {
        throw new BadRequestException('Intervalo minStockCadFrom / minStockCadTo inválido (use números).');
      }
      if (cadMin > cadMax) {
        throw new BadRequestException('minStockCadFrom não pode ser maior que minStockCadTo.');
      }
      cadastroMinStockInterval = { from: cadMin, to: cadMax };

      await this.reconcileProductInventoryControlMins(db);

      const cap = this.productMovementCadRangeMaxVariants;
      const found = await db.productVariant.findMany({
        where: {
          product: {
            inventoryControlMin: { gte: cadMin, lte: cadMax },
          },
        },
        include: {
          product: { select: { id: true, name: true, inventoryControlMin: true } },
        },
        orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
        take: cap + 1,
      });
      if (!found.length) {
        throw new BadRequestException(
          `Nenhum produto com controle de estoque (cadastro, menor mínimo entre variantes) entre ${cadMin} e ${cadMax}. Ajuste o intervalo.`,
        );
      }
      if (found.length > cap) {
        throw new BadRequestException(
          `Mais de ${cap} variações nesse conjunto (produtos cujo controle está no intervalo). ` +
            'Informe um intervalo mais restrito ou use variantId.',
        );
      }
      variants = found;
    }

    const sections: Array<{
      variant: {
        id: string;
        sku: string;
        productName: string;
        minStock: number;
        productInventoryControlMin: number;
      };
      meta: { hadMovementsInPeriod: boolean };
      rows: ProductMovementRow[];
    }> = [];

    for (const v of variants) {
      const ms = Number(v.minStock);
      const rawRows = await this.computeProductMovementRows(
        db,
        v.id,
        ms,
        periodStart,
        periodEnd,
        locationId,
        useMin,
        useMax,
        maxCeiling,
      );
      const displayRows = onlyAlerts ? rawRows.filter((r) => r.belowMinStock || r.aboveMaxStock) : rawRows;
      let includeSection: boolean;
      if (trimmedVid) {
        includeSection = !(onlyAlerts && displayRows.length === 0);
      } else if (displayRows.length > 0) {
        includeSection = true;
      } else if (showNoMovement && rawRows.length === 0) {
        includeSection = true;
      } else {
        includeSection = false;
      }
      if (!includeSection) {
        continue;
      }
      const pic = Number(v.product.inventoryControlMin);
      sections.push({
        variant: {
          id: v.id,
          sku: v.sku,
          productName: v.product.name,
          minStock: ms,
          productInventoryControlMin: pic,
        },
        meta: { hadMovementsInPeriod: rawRows.length > 0 },
        rows: displayRows,
      });
    }

    const baseNote =
      'Saldo antes/depois por local. Ajustes (ADJUST) definem saldo absoluto. Controle mínimo por movimento usa o estoque mínimo da variação; o máximo é um teto informado no filtro. ' +
      'O intervalo cadastro aplicado ao conjunto refere-se ao controle gravado no produto (menor mínimo entre variantes). Filtro “somente alertas” restringe às linhas que violam os limites ativos.';
    let noteCad = '';
    if (cadastroMinStockInterval) {
      const productCount = new Set(variants.map((x) => x.product.id)).size;
      noteCad =
        ` Filtro de conjunto: produtos com controle de estoque cadastrado entre ${cadastroMinStockInterval.from} e ` +
        `${cadastroMinStockInterval.to} (${productCount} produtos, ${variants.length} variações; ` +
        `${sections.length} exibidas após filtros).`;
    }

    return {
      title: 'Movimentação de produtos',
      period: { from: fromRaw, to: toRaw },
      locationId: locationId ?? null,
      cadastroMinStockInterval,
      options: {
        useMinControl: useMin,
        useMaxControl: useMax,
        maxStockCeiling: maxCeiling,
        alertsOnly: onlyAlerts,
        showNoMovement,
      },
      note: `${baseNote}${noteCad}`,
      sections,
    };
  }


  /**
   * Giro de produtos no período (vendas concluídas). Lucro aproximado por custo médio móvel no tempo,
   * reconstruído via histórico de custo (ProductVariantPriceHistory CUSTO) — alinhado a práticas de varejo
   * sem rastreio por lote (custo aplicado = último custo registrado até o instante da venda).
   *
   * Modos:
   * - Sem `variantId` e sem intervalo `minStockCadFrom`/`minStockCadTo`: ranking só das variantes que venderam no período (legado).
   * - Com `variantId` ou com intervalo cadastro (controle do produto = menor mínimo entre SKUs): lista o conjunto de variantes
   *   alinhado ao relatório de movimentação; `showNoSale` mantém linhas com quantidade vendida zero (padrão verdadeiro).
   */
  @Get('product-turnover')
  @Roles('admin', 'manager', 'seller', 'finance')
  async productTurnover(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw: string,
    @Query('to') toRaw: string,
    @Query('take') takeRaw?: string,
    @Query('variantId') variantIdRaw?: string,
    @Query('minStockCadFrom') minStockCadFromRaw?: string,
    @Query('minStockCadTo') minStockCadToRaw?: string,
    @Query('showNoSale') showNoSaleRaw?: string,
    @Query('maxStockCeiling') maxStockCeilingRaw?: string,
    @Query('useMinControl') useMinControl?: string,
    @Query('useMaxControl') useMaxControl?: string,
    @Query('alertsOnly') alertsOnly?: string,
  ) {
    if (!fromRaw || !toRaw) throw new BadRequestException('Informe from e to (YYYY-MM-DD).');
    const periodStart = parseReportDate(fromRaw, 'start');
    const periodEnd = parseReportDate(toRaw, 'end');
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException('Período inválido: data final anterior à inicial.');
    }
    const take = Math.min(500, Math.max(1, parseInt(String(takeRaw ?? '80'), 10) || 80));

    const useMin = useMinControl === '1' || useMinControl === 'true';
    const useMax = useMaxControl === '1' || useMaxControl === 'true';
    const onlyAlerts = alertsOnly === '1' || alertsOnly === 'true';
    let maxCeiling: number | null = null;
    if (maxStockCeilingRaw != null && String(maxStockCeilingRaw).trim() !== '') {
      maxCeiling = Number(String(maxStockCeilingRaw).replace(',', '.'));
      if (Number.isNaN(maxCeiling) || maxCeiling < 0) {
        throw new BadRequestException('Teto de estoque (máximo) inválido.');
      }
    }
    if (useMax && maxCeiling == null) {
      throw new BadRequestException('Informe o teto de estoque ao usar controle máximo.');
    }
    if (onlyAlerts && !useMin && !(useMax && maxCeiling != null)) {
      throw new BadRequestException(
        'Para listar somente alertas de estoque, ative o controle mínimo e/ou o máximo com teto informado.',
      );
    }

    const db = await this.tenantPrisma.getClient(user.tenantSlug);

    const items = await db.saleItem.findMany({
      where: {
        sale: {
          status: SaleStatus.COMPLETED,
          createdAt: { gte: periodStart, lte: periodEnd },
        },
      },
      include: {
        variant: { include: { product: { select: { name: true } } } },
        sale: { select: { createdAt: true } },
      },
    });

    const trimmedVid = (variantIdRaw ?? '').trim();
    let cadastroMinStockInterval: { from: number; to: number } | null = null;

    type TurnVariantRow = {
      id: string;
      sku: string;
      minStock: Prisma.Decimal;
      costAverage: Prisma.Decimal;
      product: { id: string; name: string; inventoryControlMin: Prisma.Decimal };
    };

    let variants: TurnVariantRow[];

    if (trimmedVid) {
      const v = await db.productVariant.findUnique({
        where: { id: trimmedVid },
        select: {
          id: true,
          sku: true,
          minStock: true,
          costAverage: true,
          product: { select: { id: true, name: true, inventoryControlMin: true } },
        },
      });
      if (!v) throw new BadRequestException('Variação não encontrada.');
      variants = [v];
    } else {
      const fromTxt = String(minStockCadFromRaw ?? '').trim();
      const toTxt = String(minStockCadToRaw ?? '').trim();
      if (fromTxt || toTxt) {
        if (!fromTxt || !toTxt) {
          throw new BadRequestException(
            'Informe ambos minStockCadFrom e minStockCadTo ou deixe os dois em branco (apenas ranking das variantes que venderam no período).',
          );
        }
        const cadMin = Number(fromTxt.replace(',', '.'));
        const cadMax = Number(toTxt.replace(',', '.'));
        if (Number.isNaN(cadMin) || Number.isNaN(cadMax)) {
          throw new BadRequestException('Intervalo minStockCadFrom / minStockCadTo inválido (use números).');
        }
        if (cadMin > cadMax) {
          throw new BadRequestException('minStockCadFrom não pode ser maior que minStockCadTo.');
        }
        cadastroMinStockInterval = { from: cadMin, to: cadMax };
        await this.reconcileProductInventoryControlMins(db);
        const cap = this.productMovementCadRangeMaxVariants;
        const found = await db.productVariant.findMany({
          where: {
            product: {
              inventoryControlMin: { gte: cadMin, lte: cadMax },
            },
          },
          select: {
            id: true,
            sku: true,
            minStock: true,
            costAverage: true,
            product: { select: { id: true, name: true, inventoryControlMin: true } },
          },
          orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
          take: cap + 1,
        });
        if (!found.length) {
          throw new BadRequestException(
            `Nenhum produto com controle de estoque (cadastro, menor mínimo entre variantes) entre ${cadMin} e ${cadMax}. Ajuste o intervalo.`,
          );
        }
        if (found.length > cap) {
          throw new BadRequestException(
            `Mais de ${cap} variações nesse conjunto (produtos cujo controle está no intervalo). ` +
              'Informe um intervalo mais restrito ou use variantId.',
          );
        }
        variants = found;
      } else {
        const saleVariantIds = [...new Set(items.map((i) => i.variantId))];
        if (saleVariantIds.length === 0) {
          variants = [];
        } else {
          variants = await db.productVariant.findMany({
            where: { id: { in: saleVariantIds } },
            select: {
              id: true,
              sku: true,
              minStock: true,
              costAverage: true,
              product: { select: { id: true, name: true, inventoryControlMin: true } },
            },
          });
        }
      }
    }

    const isConjuntoMode = Boolean(trimmedVid || cadastroMinStockInterval);
    const showNoSale = isConjuntoMode && showNoSaleRaw !== '0' && showNoSaleRaw !== 'false';

    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const variantIds = variants.map((v) => v.id);

    const stockRows =
      variantIds.length === 0
        ? []
        : await db.stockBalance.findMany({
            where: { variantId: { in: variantIds } },
            select: { variantId: true, quantity: true },
          });
    const stockTotalByVariant = new Map<string, number>();
    for (const row of stockRows) {
      const q = Number(row.quantity);
      stockTotalByVariant.set(row.variantId, (stockTotalByVariant.get(row.variantId) ?? 0) + q);
    }

    const costHistories =
      variantIds.length === 0
        ? []
        : await db.productVariantPriceHistory.findMany({
            where: { variantId: { in: variantIds }, field: 'COST' },
            orderBy: [{ variantId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          });
    const histByVariant = new Map<string, typeof costHistories>();
    for (const h of costHistories) {
      if (!histByVariant.has(h.variantId)) histByVariant.set(h.variantId, []);
      histByVariant.get(h.variantId)!.push(h);
    }

    function unitCostAtSale(variantIdKey: string, saleTime: Date): number {
      const v = variantMap.get(variantIdKey);
      if (!v) return 0;
      const list = histByVariant.get(variantIdKey) ?? [];
      let unit = list.length > 0 ? Number(list[0].previousValue) : Number(v.costAverage);
      for (const h of list) {
        if (h.createdAt.getTime() <= saleTime.getTime()) unit = Number(h.newValue);
        else break;
      }
      return unit;
    }

    type Agg = { qty: number; revenue: number; cogs: number };
    const agg = new Map<string, Agg>();
    for (const it of items) {
      if (!variantMap.has(it.variantId)) continue;
      const qty = Number(it.quantity);
      const revenue = Number(it.totalLine);
      const cogs = qty * unitCostAtSale(it.variantId, it.sale.createdAt);
      const cur = agg.get(it.variantId) ?? { qty: 0, revenue: 0, cogs: 0 };
      cur.qty += qty;
      cur.revenue += revenue;
      cur.cogs += cogs;
      agg.set(it.variantId, cur);
    }

    const EPS = 1e-9;
    let methodology =
      'Vendas concluídas no período. Custo estimado pelo custo médio vigente até a data da venda; estoque atual = soma nos locais. Sem lote.';
    if (useMin || useMax || onlyAlerts) {
      methodology += ' Alertas: estoque atual vs. mín. da SKU e/ou teto.';
    }
    if (cadastroMinStockInterval) {
      const productCount = new Set(variants.map((x) => x.product.id)).size;
      methodology += ` Conjunto por controle produto ${cadastroMinStockInterval.from}–${cadastroMinStockInterval.to} (${productCount} prod., ${variants.length} SKUs).`;
    }

    const lines =
      variants.length === 0
        ? []
        : variants
            .map((v) => {
              const vid = v.id;
              const a = agg.get(vid) ?? { qty: 0, revenue: 0, cogs: 0 };
              if (isConjuntoMode && !showNoSale && a.qty === 0) return null;

              const avgSale = a.qty > 0 ? a.revenue / a.qty : 0;
              const avgCost = a.qty > 0 ? a.cogs / a.qty : 0;
              const onHand = stockTotalByVariant.get(vid) ?? 0;
              const minS = Number(v.minStock);
              const belowMinStock = useMin && onHand + EPS < minS;
              const aboveMaxStock = useMax && maxCeiling != null && onHand > maxCeiling + EPS;

              if (onlyAlerts && !belowMinStock && !aboveMaxStock) return null;

              return {
                variantId: vid,
                sku: v.sku,
                productName: v.product.name,
                minStock: minS,
                productInventoryControlMin: Number(v.product.inventoryControlMin),
                stockOnHand: onHand,
                belowMinStock,
                aboveMaxStock,
                qtySold: a.qty,
                revenue: a.revenue,
                avgSalePrice: avgSale,
                avgCostAtSale: avgCost,
                profit: a.revenue - a.cogs,
              };
            })
            .filter((row): row is NonNullable<typeof row> => row != null)
            .sort((x, y) => y.qtySold - x.qtySold || x.sku.localeCompare(y.sku))
            .slice(0, take);

    return {
      title: 'Giro de produtos',
      period: { from: fromRaw, to: toRaw },
      cadastroMinStockInterval,
      options: {
        useMinControl: useMin,
        useMaxControl: useMax,
        maxStockCeiling: maxCeiling,
        alertsOnly: onlyAlerts,
        showNoSale: isConjuntoMode ? showNoSale : false,
      },
      methodology,
      lines,
    };
  }

  private readonly stockReportMaxVariants = 5000;

  /** Saldo da variação na data de referência (replay de movimentos até `asOf`). */
  private async stockQtyByVariantAtAsOf(
    db: PrismaClient,
    variantIds: string[],
    asOf: Date,
    locationId?: string,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!variantIds.length) return result;

    const where: Prisma.StockMovementWhereInput = {
      variantId: { in: variantIds },
      createdAt: { lte: asOf },
    };
    if (locationId) where.locationId = locationId;

    const moves = await db.stockMovement.findMany({
      where,
      orderBy: [{ variantId: 'asc' }, { locationId: 'asc' }, { createdAt: 'asc' }, { controlNumber: 'asc' }],
      select: { variantId: true, locationId: true, type: true, quantity: true },
    });

    if (locationId) {
      const byVariant = new Map<string, StockMovementSnap[]>();
      for (const m of moves) {
        if (!byVariant.has(m.variantId)) byVariant.set(m.variantId, []);
        byVariant.get(m.variantId)!.push(m);
      }
      for (const vid of variantIds) {
        result.set(vid, replayQty(byVariant.get(vid) ?? []));
      }
      return result;
    }

    const byVariantLoc = new Map<string, StockMovementSnap[]>();
    for (const m of moves) {
      const key = `${m.variantId}\t${m.locationId}`;
      if (!byVariantLoc.has(key)) byVariantLoc.set(key, []);
      byVariantLoc.get(key)!.push(m);
    }
    for (const vid of variantIds) {
      let total = 0;
      for (const [key, seq] of byVariantLoc) {
        if (key.startsWith(`${vid}\t`)) total += replayQty(seq);
      }
      result.set(vid, total);
    }
    return result;
  }

  private parseStockReportPeriod(fromRaw?: string, toRaw?: string): { from: string; to: string; asOf: Date } {
    if (!fromRaw || !toRaw) throw new BadRequestException('Informe from e to (YYYY-MM-DD).');
    const periodStart = parseReportDate(fromRaw, 'start');
    const periodEnd = parseReportDate(toRaw, 'end');
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException('Período inválido: data final anterior à inicial.');
    }
    return { from: fromRaw, to: toRaw, asOf: periodEnd };
  }

  private parseOptionalCadInterval(
    fromRaw?: string,
    toRaw?: string,
  ): { from: number; to: number } | null {
    const fromTxt = String(fromRaw ?? '').trim();
    const toTxt = String(toRaw ?? '').trim();
    if (!fromTxt && !toTxt) return null;
    if (!fromTxt || !toTxt) {
      throw new BadRequestException('Informe ambos minStockCadFrom e minStockCadTo ou deixe os dois em branco.');
    }
    const cadMin = Number(fromTxt.replace(',', '.'));
    const cadMax = Number(toTxt.replace(',', '.'));
    if (Number.isNaN(cadMin) || Number.isNaN(cadMax)) {
      throw new BadRequestException('Intervalo minStockCadFrom / minStockCadTo inválido (use números).');
    }
    if (cadMin > cadMax) {
      throw new BadRequestException('minStockCadFrom não pode ser maior que minStockCadTo.');
    }
    return { from: cadMin, to: cadMax };
  }

  private async loadStockReportVariants(
    db: PrismaClient,
    cadInterval: { from: number; to: number } | null,
    categoryId?: string,
  ) {
    await this.reconcileProductInventoryControlMins(db);

    const productWhere: Prisma.ProductWhereInput = { isActive: true };
    const cat = (categoryId ?? '').trim();
    if (cat) productWhere.categoryId = cat;
    if (cadInterval) {
      productWhere.inventoryControlMin = { gte: cadInterval.from, lte: cadInterval.to };
    }

    const variants = await db.productVariant.findMany({
      where: { product: productWhere },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            inventoryControlMin: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
      take: this.stockReportMaxVariants + 1,
    });

    if (variants.length > this.stockReportMaxVariants) {
      throw new BadRequestException(
        `Mais de ${this.stockReportMaxVariants} variações no conjunto. Restrinja controle, grupo ou cadastro.`,
      );
    }
    return variants;
  }

  private stockReportFiltersMeta(
    period: { from: string; to: string },
    locationId?: string,
    categoryId?: string,
    categoryName?: string | null,
    cadInterval?: { from: number; to: number } | null,
  ) {
    return {
      period,
      asOfDate: period.to,
      locationId: locationId?.trim() || null,
      categoryId: categoryId?.trim() || null,
      categoryName: categoryName ?? null,
      cadastroMinStockInterval: cadInterval ?? null,
    };
  }

  /**
   * Estoque financeiro: valor do estoque ao custo médio e lucro bruto potencial (preço varejo − custo) × quantidade.
   * Posição na data final do período (`to`).
   */
  @Get('product-financial-stock')
  @Roles('admin', 'manager', 'seller', 'finance')
  async productFinancialStock(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('locationId') locationId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('minStockCadFrom') minStockCadFromRaw?: string,
    @Query('minStockCadTo') minStockCadToRaw?: string,
  ) {
    const period = this.parseStockReportPeriod(fromRaw, toRaw);
    const cadInterval = this.parseOptionalCadInterval(minStockCadFromRaw, minStockCadToRaw);
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const variants = await this.loadStockReportVariants(db, cadInterval, categoryId);
    const variantIds = variants.map((v) => v.id);
    const qtyMap = await this.stockQtyByVariantAtAsOf(db, variantIds, period.asOf, locationId?.trim() || undefined);

    let totalQty = 0;
    let totalStockValue = 0;
    let totalProfit = 0;

    const lines = variants.map((v) => {
      const qty = qtyMap.get(v.id) ?? 0;
      const unitCost = Number(v.costAverage);
      const unitRetail = Number(v.retailPrice);
      const stockValue = qty * unitCost;
      const unitProfit = unitRetail - unitCost;
      const profit = qty * unitProfit;
      totalQty += qty;
      totalStockValue += stockValue;
      totalProfit += profit;
      return {
        variantId: v.id,
        sku: v.sku,
        productName: v.product.name,
        categoryName: v.product.category?.name ?? null,
        inventoryControlMin: Number(v.product.inventoryControlMin),
        minStock: Number(v.minStock),
        quantity: qty,
        unitCost,
        unitRetailPrice: unitRetail,
        stockValue,
        unitProfit,
        profit,
      };
    });

    const categoryName =
      categoryId?.trim() && variants.length
        ? (variants.find((x) => x.product.category?.id === categoryId.trim())?.product.category?.name ?? null)
        : null;

    return {
      title: 'Estoque financeiro',
      ...this.stockReportFiltersMeta(period, locationId, categoryId, categoryName, cadInterval),
      note:
        'Saldo na data final do período (replay de movimentações). Valor financeiro = quantidade × custo médio. ' +
        'Lucro = quantidade × (preço varejo − custo) — margem bruta potencial sobre o estoque em mãos, sem considerar impostos ou despesas.',
      lines,
      totals: {
        quantity: totalQty,
        stockValue: totalStockValue,
        profit: totalProfit,
      },
    };
  }

  /**
   * Estoque físico: quantidades e valor de face (quantidade × preço varejo).
   * Posição na data final do período (`to`).
   */
  @Get('product-physical-stock')
  @Roles('admin', 'manager', 'seller', 'finance')
  async productPhysicalStock(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('locationId') locationId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('minStockCadFrom') minStockCadFromRaw?: string,
    @Query('minStockCadTo') minStockCadToRaw?: string,
  ) {
    const period = this.parseStockReportPeriod(fromRaw, toRaw);
    const cadInterval = this.parseOptionalCadInterval(minStockCadFromRaw, minStockCadToRaw);
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const variants = await this.loadStockReportVariants(db, cadInterval, categoryId);
    const variantIds = variants.map((v) => v.id);
    const qtyMap = await this.stockQtyByVariantAtAsOf(db, variantIds, period.asOf, locationId?.trim() || undefined);

    let totalQty = 0;
    let totalSaleValue = 0;

    const lines = variants.map((v) => {
      const qty = qtyMap.get(v.id) ?? 0;
      const unitRetail = Number(v.retailPrice);
      const saleValue = qty * unitRetail;
      totalQty += qty;
      totalSaleValue += saleValue;
      return {
        variantId: v.id,
        sku: v.sku,
        productName: v.product.name,
        categoryName: v.product.category?.name ?? null,
        inventoryControlMin: Number(v.product.inventoryControlMin),
        minStock: Number(v.minStock),
        quantity: qty,
        unitRetailPrice: unitRetail,
        saleValue,
      };
    });

    const categoryName =
      categoryId?.trim() && variants.length
        ? (variants.find((x) => x.product.category?.id === categoryId.trim())?.product.category?.name ?? null)
        : null;

    return {
      title: 'Estoque físico',
      ...this.stockReportFiltersMeta(period, locationId, categoryId, categoryName, cadInterval),
      note:
        'Saldo físico na data final do período. Valor total de face = quantidade × preço varejo cadastrado (sem promoções).',
      lines,
      totals: {
        quantity: totalQty,
        saleValue: totalSaleValue,
      },
    };
  }

  /**
   * Estoque mínimo: variações com saldo na data final igual ou abaixo do mínimo cadastrado da SKU.
   */
  @Get('product-minimum-stock')
  @Roles('admin', 'manager', 'seller', 'finance')
  async productMinimumStock(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('locationId') locationId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('minStockCadFrom') minStockCadFromRaw?: string,
    @Query('minStockCadTo') minStockCadToRaw?: string,
  ) {
    const period = this.parseStockReportPeriod(fromRaw, toRaw);
    const cadInterval = this.parseOptionalCadInterval(minStockCadFromRaw, minStockCadToRaw);
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const variants = await this.loadStockReportVariants(db, cadInterval, categoryId);
    const variantIds = variants.map((v) => v.id);
    const qtyMap = await this.stockQtyByVariantAtAsOf(db, variantIds, period.asOf, locationId?.trim() || undefined);

    const EPS = 1e-9;
    const lines: Array<{
      variantId: string;
      sku: string;
      productName: string;
      categoryName: string | null;
      inventoryControlMin: number;
      minStock: number;
      quantity: number;
      deficit: number;
    }> = [];

    for (const v of variants) {
      const qty = qtyMap.get(v.id) ?? 0;
      const minS = Number(v.minStock);
      if (qty > minS + EPS) continue;
      lines.push({
        variantId: v.id,
        sku: v.sku,
        productName: v.product.name,
        categoryName: v.product.category?.name ?? null,
        inventoryControlMin: Number(v.product.inventoryControlMin),
        minStock: minS,
        quantity: qty,
        deficit: Math.max(0, minS - qty),
      });
    }

    const categoryName =
      categoryId?.trim() && variants.length
        ? (variants.find((x) => x.product.category?.id === categoryId.trim())?.product.category?.name ?? null)
        : null;

    return {
      title: 'Estoque mínimo',
      ...this.stockReportFiltersMeta(period, locationId, categoryId, categoryName, cadInterval),
      note:
        'Lista variações com saldo na data final igual ou abaixo do estoque mínimo da SKU. ' +
        'Déficit = mínimo − quantidade (zero quando empatado no mínimo).',
      lines,
      totals: {
        linesCount: lines.length,
        totalDeficit: lines.reduce((s, r) => s + r.deficit, 0),
      },
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
