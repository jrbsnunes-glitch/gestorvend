import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  BillStatus,
  CashMovementType,
  PaymentMethod,
  SaleStatus,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { endOfDay, parseQueryDate, startOfDay } from '../common/date-range.util';
import { rowMatchesSelectedCostCenter } from '../common/referential-account-flow';
import { buildProfitabilityReport } from './profitability.report';

/** Piso de período acumulado quando não há datas na query (visão balanço principal). */
const ACCUMULATED_FLOOR_YEAR = 2026;
const ACCUMULATED_FLOOR_MONTH = 0; // janeiro = 0

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function paymentMethodLabel(m: PaymentMethod | string | null | undefined): string {
  if (!m) return '—';
  const u = String(m);
  const map: Record<string, string> = {
    CASH: 'Dinheiro',
    CARD: 'Cartão',
    PIX: 'Pix',
    CREDIT: 'Crediário',
    OTHER: 'Outro',
    EXPENSE: 'Despesas',
  };
  return map[u] ?? u;
}

function reasonBucket(
  reason: string | null | undefined,
  method?: PaymentMethod | string | null,
): string {
  if (method === PaymentMethod.EXPENSE || method === 'EXPENSE') return 'Despesas de caixa';
  if (!reason || !String(reason).trim()) return 'Outros';
  const r = String(reason).trim();
  if (r.startsWith('Pagamento:')) return 'Contas a pagar';
  if (r.startsWith('Recebimento:')) return 'Contas a receber';
  if (r.toLowerCase().includes('venda')) return 'Vendas / PDV';
  return 'Demais movimentos';
}

function supplierDisplay(
  s: { legalName: string; tradeName: string | null } | null | undefined,
): string | null {
  if (!s) return null;
  const t = s.tradeName?.trim();
  if (t) return t;
  return s.legalName?.trim() || null;
}

@Controller('financial-overview')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinancialOverviewController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Início do acumulado: maior entre 01/01/2026 e o primeiro registro financeiro
   * (venda, movimento de caixa, contas a pagar ou a receber).
   */
  private async computeAccumulatedFrom(db: {
    sale: {
      findFirst: (args: unknown) => Promise<{ createdAt: Date } | null>;
    };
    cashMovement: {
      findFirst: (args: unknown) => Promise<{ createdAt: Date } | null>;
    };
    accountPayable: {
      findFirst: (args: unknown) => Promise<{ createdAt: Date } | null>;
    };
    accountReceivable: {
      findFirst: (args: unknown) => Promise<{ createdAt: Date } | null>;
    };
  }): Promise<Date> {
    const floor = startOfDay(new Date(ACCUMULATED_FLOOR_YEAR, ACCUMULATED_FLOOR_MONTH, 1));
    const [firstSale, firstMov, firstPay, firstRec] = await Promise.all([
      db.sale.findFirst({
        where: { status: SaleStatus.COMPLETED },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      db.cashMovement.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      db.accountPayable.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      db.accountReceivable.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    let earliest: Date | null = null;
    for (const row of [firstSale, firstMov, firstPay, firstRec]) {
      if (!row) continue;
      const d = startOfDay(row.createdAt);
      if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
    }
    if (!earliest) return floor;
    return earliest.getTime() > floor.getTime() ? earliest : floor;
  }

  /**
   * Contas do plano referencial para centro de custo:
   * - `flow=IN`: receitas (grupo 6).
   * - `flow=OUT`: todas as contas exceto receitas (adequado a pagamentos a fornecedores).
   * - `flow=EXPENSE`: apenas custos/despesas (4 e 5) — despesa de caixa.
   * - omita ou `ALL`: união usada em relatórios (4, 5 e 6).
   */
  @Get('cost-centers')
  @Roles('admin', 'manager', 'finance')
  async costCenters(
    @CurrentUser() user: JwtPayload,
    @Query('flow') flowRaw?: string,
    @Query('sourceVersion') sourceVersion?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const verTrim = sourceVersion?.trim();
    const ver =
      verTrim ||
      (
        await db.referentialAccount.findFirst({
          orderBy: [{ sourceVersion: 'asc' }],
          select: { sourceVersion: true },
        })
      )?.sourceVersion ||
      'RFB-sample-v1';

    const flow = flowRaw?.trim().toUpperCase();

    const baseVersion: Prisma.ReferentialAccountWhereInput = { sourceVersion: ver };

    let where: Prisma.ReferentialAccountWhereInput;
    if (flow === 'IN') {
      where = {
        ...baseVersion,
        OR: [{ code: '6' }, { code: { startsWith: '6.' } }],
      };
    } else if (flow === 'OUT') {
      where = {
        ...baseVersion,
        NOT: {
          OR: [{ code: '6' }, { code: { startsWith: '6.' } }],
        },
      };
    } else if (flow === 'EXPENSE') {
      where = {
        ...baseVersion,
        OR: [
          { code: '4' },
          { code: { startsWith: '4.' } },
          { code: '5' },
          { code: { startsWith: '5.' } },
        ],
      };
    } else if (flow != null && flow !== '' && flow !== 'ALL') {
      throw new BadRequestException(
        'Use flow=IN, flow=OUT, flow=EXPENSE ou omita / ALL para listar centros.',
      );
    } else {
      where = {
        ...baseVersion,
        OR: [
          { code: '4' },
          { code: { startsWith: '4.' } },
          { code: '5' },
          { code: { startsWith: '5.' } },
          { code: '6' },
          { code: { startsWith: '6.' } },
        ],
      };
    }

    return db.referentialAccount.findMany({
      where,
      orderBy: { code: 'asc' },
      take: 8000,
      select: { id: true, code: true, description: true, sourceVersion: true },
    });
  }

  @Get('summary')
  @Roles('admin', 'manager', 'finance')
  async summary(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('costCenterId') costCenterIdRaw?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const now = new Date();
    let from: Date;
    let to: Date;
    let periodIsCustom: boolean;

    if (!fromRaw && !toRaw) {
      from = await this.computeAccumulatedFrom(db);
      to = endOfDay(now);
      periodIsCustom = false;
    } else {
      if (!fromRaw || !toRaw) {
        throw new BadRequestException(
          'Informe "from" e "to" juntos, ou omita ambos para o período acumulado.',
        );
      }
      from = parseQueryDate(fromRaw, 'start');
      to = parseQueryDate(toRaw, 'end');
      periodIsCustom = true;
    }

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Datas inválidas em "from"/"to".');
    }
    if (from > to) {
      throw new BadRequestException('A data inicial deve ser anterior à data final.');
    }

    let costCenterFilter: { id: string; code: string; description: string } | null = null;
    if (costCenterIdRaw != null && String(costCenterIdRaw).trim() !== '') {
      const cc = await db.referentialAccount.findUnique({
        where: { id: String(costCenterIdRaw).trim() },
        select: { id: true, code: true, description: true },
      });
      if (!cc) {
        throw new BadRequestException('Centro de custo inválido.');
      }
      costCenterFilter = cc;
    }

    const [priorMovements, periodMovements] = await Promise.all([
      db.cashMovement.findMany({
        where: { createdAt: { lt: from } },
        select: { type: true, amount: true, method: true, reason: true },
      }),
      db.cashMovement.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: {
          id: true,
          type: true,
          amount: true,
          method: true,
          reason: true,
          referentialAccountId: true,
          referentialAccount: { select: { id: true, code: true, description: true } },
          createdAt: true,
          sessionId: true,
          session: {
            select: {
              controlNumber: true,
              user: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 8000,
      }),
    ]);

    let openingCashInferred = 0;
    const openingByMethod = new Map<string, { inflow: number; outflow: number }>();
    const addOpening = (methodKey: string, isIn: boolean, v: number) => {
      const cur = openingByMethod.get(methodKey) ?? { inflow: 0, outflow: 0 };
      if (isIn) cur.inflow += v;
      else cur.outflow += v;
      openingByMethod.set(methodKey, cur);
    };

    for (const m of priorMovements) {
      const v = num(m.amount);
      const isIn = m.type === CashMovementType.IN;
      if (isIn) openingCashInferred += v;
      else openingCashInferred -= v;
      addOpening(paymentMethodLabel(m.method), isIn, v);
    }

    let periodInflows = 0;
    let periodOutflows = 0;
    const periodByMethod = new Map<string, { inflow: number; outflow: number }>();
    const periodByBucket = new Map<string, { inflow: number; outflow: number }>();

    const addPeriod = (
      map: Map<string, { inflow: number; outflow: number }>,
      key: string,
      isIn: boolean,
      v: number,
    ) => {
      const cur = map.get(key) ?? { inflow: 0, outflow: 0 };
      if (isIn) cur.inflow += v;
      else cur.outflow += v;
      map.set(key, cur);
    };

    const movementLines = periodMovements.map((m) => {
      const v = num(m.amount);
      const isIn = m.type === CashMovementType.IN;
      if (isIn) periodInflows += v;
      else periodOutflows += v;
      addPeriod(periodByMethod, paymentMethodLabel(m.method), isIn, v);
      addPeriod(periodByBucket, reasonBucket(m.reason, m.method), isIn, v);
      return {
        id: m.id,
        type: m.type,
        amount: v.toFixed(2),
        method: m.method,
        methodLabel: paymentMethodLabel(m.method),
        reason: m.reason,
        reasonBucket: reasonBucket(m.reason, m.method),
        referentialAccountId: m.referentialAccountId,
        referentialAccountCode: m.referentialAccount?.code ?? null,
        referentialAccountLabel: m.referentialAccount
          ? `${m.referentialAccount.code} — ${m.referentialAccount.description}`
          : null,
        createdAt: m.createdAt.toISOString(),
        sessionControl: m.session.controlNumber,
        operatorName: m.session.user?.name ?? null,
      };
    });

    /**
     * Vendas concluídas não geram registros em `CashMovement` (só pagamentos
     * manuais / financeiro). O caixa soma vendas via `SalePayment`; o balanço
     * precisa fazer o mesmo para não zerar entradas "de PDV".
     */
    /** Pagamentos de venda que entram no “pool” de caixa (exclui crediário). */
    const salePaymentBaseWhere = {
      method: { not: PaymentMethod.CREDIT },
    } satisfies Prisma.SalePaymentWhereInput;

    const [priorSalePayByMethod, periodSalePayByMethod] = await Promise.all([
      db.salePayment.groupBy({
        by: ['method'],
        where: {
          ...salePaymentBaseWhere,
          sale: { status: SaleStatus.COMPLETED, createdAt: { lt: from } },
        },
        _sum: { amount: true },
      }),
      db.salePayment.groupBy({
        by: ['method'],
        where: {
          ...salePaymentBaseWhere,
          sale: {
            status: SaleStatus.COMPLETED,
            createdAt: { gte: from, lte: to },
          },
        },
        _sum: { amount: true },
      }),
    ]);

    for (const row of priorSalePayByMethod) {
      const v = num(row._sum.amount);
      if (v <= 0) continue;
      openingCashInferred += v;
      addOpening(paymentMethodLabel(row.method), true, v);
    }

    /** Liquidações no financeiro sem caixa (antes do período). Com caixa, o movimento já entrou acima. */
    const [
      priorRecSettleByM,
      priorPaySettleByM,
      priorRecLegacyByM,
      priorPayLegacyByM,
    ] = await Promise.all([
      db.receivableSettlement.groupBy({
        by: ['method'],
        where: { cashSessionId: null, receivedAt: { lt: from } },
        _sum: { amount: true },
      }),
      db.payableSettlement.groupBy({
        by: ['method'],
        where: { cashSessionId: null, paidAt: { lt: from } },
        _sum: { amount: true },
      }),
      db.accountReceivable.groupBy({
        by: ['paymentMethod'],
        where: {
          status: BillStatus.PAID,
          cashSessionId: null,
          receivedAt: { lt: from },
          settlements: { none: {} },
        },
        _sum: { settledAmount: true },
      }),
      db.accountPayable.groupBy({
        by: ['paymentMethod'],
        where: {
          status: BillStatus.PAID,
          cashSessionId: null,
          paidAt: { lt: from },
          settlements: { none: {} },
        },
        _sum: { settledAmount: true },
      }),
    ]);

    for (const row of priorRecSettleByM) {
      const v = num(row._sum.amount);
      if (v <= 0) continue;
      openingCashInferred += v;
      addOpening(paymentMethodLabel(row.method), true, v);
    }
    for (const row of priorPaySettleByM) {
      const v = num(row._sum.amount);
      if (v <= 0) continue;
      openingCashInferred -= v;
      addOpening(paymentMethodLabel(row.method), false, v);
    }
    for (const row of priorRecLegacyByM) {
      const v = num(row._sum.settledAmount);
      if (v <= 0) continue;
      openingCashInferred += v;
      addOpening(paymentMethodLabel(row.paymentMethod), true, v);
    }
    for (const row of priorPayLegacyByM) {
      const v = num(row._sum.settledAmount);
      if (v <= 0) continue;
      openingCashInferred -= v;
      addOpening(paymentMethodLabel(row.paymentMethod), false, v);
    }

    let salePaymentsInPeriod = 0;
    for (const row of periodSalePayByMethod) {
      const v = num(row._sum.amount);
      if (v <= 0) continue;
      salePaymentsInPeriod += v;
      periodInflows += v;
      addPeriod(periodByMethod, paymentMethodLabel(row.method), true, v);
    }
    if (salePaymentsInPeriod > 0) {
      addPeriod(periodByBucket, 'Vendas / PDV', true, salePaymentsInPeriod);
    }

    /** Liquidações sem caixa no período (parciais inclusos). Com caixa: só movimento acima. */
    const [
      periodRecSettleByM,
      periodPaySettleByM,
      periodRecLegacyByM,
      periodPayLegacyByM,
    ] = await Promise.all([
      db.receivableSettlement.groupBy({
        by: ['method'],
        where: { cashSessionId: null, receivedAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      db.payableSettlement.groupBy({
        by: ['method'],
        where: { cashSessionId: null, paidAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      db.accountReceivable.groupBy({
        by: ['paymentMethod'],
        where: {
          status: BillStatus.PAID,
          cashSessionId: null,
          receivedAt: { gte: from, lte: to },
          settlements: { none: {} },
        },
        _sum: { settledAmount: true },
      }),
      db.accountPayable.groupBy({
        by: ['paymentMethod'],
        where: {
          status: BillStatus.PAID,
          cashSessionId: null,
          paidAt: { gte: from, lte: to },
          settlements: { none: {} },
        },
        _sum: { settledAmount: true },
      }),
    ]);

    for (const row of periodRecSettleByM) {
      const v = num(row._sum.amount);
      if (v <= 0) continue;
      periodInflows += v;
      addPeriod(periodByMethod, paymentMethodLabel(row.method), true, v);
      addPeriod(periodByBucket, 'Contas a receber', true, v);
    }
    for (const row of periodPaySettleByM) {
      const v = num(row._sum.amount);
      if (v <= 0) continue;
      periodOutflows += v;
      addPeriod(periodByMethod, paymentMethodLabel(row.method), false, v);
      addPeriod(periodByBucket, 'Contas a pagar', false, v);
    }
    for (const row of periodRecLegacyByM) {
      const v = num(row._sum.settledAmount);
      if (v <= 0) continue;
      periodInflows += v;
      addPeriod(periodByMethod, paymentMethodLabel(row.paymentMethod), true, v);
      addPeriod(periodByBucket, 'Contas a receber', true, v);
    }
    for (const row of periodPayLegacyByM) {
      const v = num(row._sum.settledAmount);
      if (v <= 0) continue;
      periodOutflows += v;
      addPeriod(periodByMethod, paymentMethodLabel(row.paymentMethod), false, v);
      addPeriod(periodByBucket, 'Contas a pagar', false, v);
    }

    const closingCashInferred = openingCashInferred + periodInflows - periodOutflows;

    const mapToArr = (m: Map<string, { inflow: number; outflow: number }>) =>
      [...m.entries()]
        .map(([key, v]) => ({
          key,
          inflow: v.inflow,
          outflow: v.outflow,
          net: v.inflow - v.outflow,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));

    const [
      salesAgg,
      payablesNewAgg,
      receivablesNewAgg,
      payablesPaidPeriod,
      receivablesReceivedPeriod,
      payablesPaidOffCash,
      receivablesReceivedOffCash,
      openPayables,
      openReceivables,
    ] = await Promise.all([
      db.sale.aggregate({
        where: {
          status: SaleStatus.COMPLETED,
          createdAt: { gte: from, lte: to },
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
      db.accountPayable.aggregate({
        where: { createdAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      db.accountReceivable.aggregate({
        where: { createdAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      db.accountPayable.aggregate({
        where: {
          status: BillStatus.PAID,
          paidAt: { gte: from, lte: to },
        },
        _sum: { settledAmount: true },
        _count: { _all: true },
      }),
      db.accountReceivable.aggregate({
        where: {
          status: BillStatus.PAID,
          receivedAt: { gte: from, lte: to },
        },
        _sum: { settledAmount: true },
        _count: { _all: true },
      }),
      db.accountPayable.aggregate({
        where: {
          status: BillStatus.PAID,
          paidAt: { gte: from, lte: to },
          cashSessionId: null,
        },
        _sum: { settledAmount: true },
        _count: { _all: true },
      }),
      db.accountReceivable.aggregate({
        where: {
          status: BillStatus.PAID,
          receivedAt: { gte: from, lte: to },
          cashSessionId: null,
        },
        _sum: { settledAmount: true },
        _count: { _all: true },
      }),
      db.accountPayable.aggregate({
        where: { status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] } },
        _sum: { amountRemaining: true },
        _count: { _all: true },
      }),
      db.accountReceivable.aggregate({
        where: { status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] } },
        _sum: { amountRemaining: true },
        _count: { _all: true },
      }),
    ]);

    const payOpen = num(openPayables._sum.amountRemaining);
    const recOpen = num(openReceivables._sum.amountRemaining);

    const [
      ledgerSalePay,
      ledgerPayCreated,
      ledgerRecCreated,
      ledgerPaySettlements,
      ledgerRecSettlements,
      ledgerPayPaidLegacy,
      ledgerRecPaidLegacy,
    ] = await Promise.all([
      db.salePayment.findMany({
        where: {
          method: { not: PaymentMethod.CREDIT },
          sale: { status: SaleStatus.COMPLETED, createdAt: { gte: from, lte: to } },
        },
        select: {
          id: true,
          amount: true,
          method: true,
          sale: { select: { number: true, createdAt: true } },
        },
        take: 4000,
      }),
      db.accountPayable.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: {
          id: true,
          description: true,
          amount: true,
          status: true,
          createdAt: true,
          supplier: { select: { legalName: true, tradeName: true } },
        },
        take: 2000,
      }),
      db.accountReceivable.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: {
          id: true,
          description: true,
          amount: true,
          status: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
        take: 2000,
      }),
      db.payableSettlement.findMany({
        where: { paidAt: { gte: from, lte: to } },
        select: {
          id: true,
          amount: true,
          paidAt: true,
          method: true,
          cashSessionId: true,
          referentialAccountId: true,
          referentialAccount: { select: { id: true, code: true, description: true } },
          payable: {
            select: {
              description: true,
              supplier: { select: { legalName: true, tradeName: true } },
            },
          },
        },
        take: 3000,
      }),
      db.receivableSettlement.findMany({
        where: { receivedAt: { gte: from, lte: to } },
        select: {
          id: true,
          amount: true,
          receivedAt: true,
          method: true,
          cashSessionId: true,
          referentialAccountId: true,
          referentialAccount: { select: { id: true, code: true, description: true } },
          receivable: {
            select: {
              description: true,
              customer: { select: { name: true } },
            },
          },
        },
        take: 3000,
      }),
      db.accountPayable.findMany({
        where: {
          status: BillStatus.PAID,
          paidAt: { gte: from, lte: to },
          settlements: { none: {} },
        },
        select: {
          id: true,
          description: true,
          settledAmount: true,
          paidAt: true,
          paymentMethod: true,
          cashSessionId: true,
          supplier: { select: { legalName: true, tradeName: true } },
        },
        take: 500,
      }),
      db.accountReceivable.findMany({
        where: {
          status: BillStatus.PAID,
          receivedAt: { gte: from, lte: to },
          settlements: { none: {} },
        },
        select: {
          id: true,
          description: true,
          settledAmount: true,
          receivedAt: true,
          paymentMethod: true,
          cashSessionId: true,
          customer: { select: { name: true } },
        },
        take: 500,
      }),
    ]);

    type LedgerDir = 'IN' | 'OUT' | 'INFO';
    const ledger: Array<{
      occurredAt: string;
      kind: string;
      direction: LedgerDir;
      amount: string;
      title: string;
      detail: string | null;
      methodLabel: string | null;
      referentialAccountId: string | null;
      referentialAccountCode: string | null;
      referentialAccountLabel: string | null;
    }> = [];

    for (const m of movementLines) {
      const rsn = m.reason ?? '';
      if (m.type === CashMovementType.OUT && rsn.trimStart().startsWith('Pagamento:')) continue;
      if (m.type === CashMovementType.IN && rsn.trimStart().startsWith('Recebimento:')) continue;
      ledger.push({
        occurredAt: m.createdAt,
        kind: 'CASH_MOVEMENT',
        direction: m.type === CashMovementType.IN ? 'IN' : 'OUT',
        amount: m.amount,
        title: m.type === CashMovementType.IN ? 'Entrada de caixa' : 'Saída de caixa',
        detail: m.reason,
        methodLabel: m.methodLabel,
        referentialAccountId: m.referentialAccountId ?? null,
        referentialAccountCode: m.referentialAccountCode ?? null,
        referentialAccountLabel: m.referentialAccountLabel ?? null,
      });
    }

    for (const sp of ledgerSalePay) {
      const v = num(sp.amount);
      ledger.push({
        occurredAt: sp.sale.createdAt.toISOString(),
        kind: 'SALE_PAYMENT',
        direction: 'IN',
        amount: v.toFixed(2),
        title: `Venda #${sp.sale.number}`,
        detail: 'Pagamento na venda (PDV)',
        methodLabel: paymentMethodLabel(sp.method),
        referentialAccountId: null,
        referentialAccountCode: null,
        referentialAccountLabel: null,
      });
    }

    for (const p of ledgerPayCreated) {
      ledger.push({
        occurredAt: p.createdAt.toISOString(),
        kind: 'PAYABLE_REGISTERED',
        direction: 'INFO',
        amount: num(p.amount).toFixed(2),
        title: 'Conta a pagar registrada',
        detail: [supplierDisplay(p.supplier), p.description].filter(Boolean).join(' — ') || p.description,
        methodLabel: null,
        referentialAccountId: null,
        referentialAccountCode: null,
        referentialAccountLabel: null,
      });
    }

    for (const r of ledgerRecCreated) {
      ledger.push({
        occurredAt: r.createdAt.toISOString(),
        kind: 'RECEIVABLE_REGISTERED',
        direction: 'INFO',
        amount: num(r.amount).toFixed(2),
        title: 'Conta a receber registrada',
        detail: [r.customer?.name, r.description].filter(Boolean).join(' — ') || r.description,
        methodLabel: null,
        referentialAccountId: null,
        referentialAccountCode: null,
        referentialAccountLabel: null,
      });
    }

    for (const s of ledgerPaySettlements) {
      const v = num(s.amount);
      if (v <= 0) continue;
      ledger.push({
        occurredAt: s.paidAt.toISOString(),
        kind: 'PAYABLE_PAYMENT',
        direction: 'OUT',
        amount: v.toFixed(2),
        title: 'Pagamento — contas a pagar',
        detail: [supplierDisplay(s.payable.supplier), s.payable.description].filter(Boolean).join(' — ') || s.payable.description,
        methodLabel: paymentMethodLabel(s.method),
        referentialAccountId: s.referentialAccountId ?? null,
        referentialAccountCode: s.referentialAccount?.code ?? null,
        referentialAccountLabel: s.referentialAccount
          ? `${s.referentialAccount.code} — ${s.referentialAccount.description}`
          : null,
      });
    }

    for (const s of ledgerRecSettlements) {
      const v = num(s.amount);
      if (v <= 0) continue;
      ledger.push({
        occurredAt: s.receivedAt.toISOString(),
        kind: 'RECEIVABLE_PAYMENT',
        direction: 'IN',
        amount: v.toFixed(2),
        title: 'Recebimento — contas a receber',
        detail: [s.receivable.customer?.name, s.receivable.description].filter(Boolean).join(' — ') || s.receivable.description,
        methodLabel: paymentMethodLabel(s.method),
        referentialAccountId: s.referentialAccountId ?? null,
        referentialAccountCode: s.referentialAccount?.code ?? null,
        referentialAccountLabel: s.referentialAccount
          ? `${s.referentialAccount.code} — ${s.referentialAccount.description}`
          : null,
      });
    }

    for (const p of ledgerPayPaidLegacy) {
      if (!p.paidAt) continue;
      const v = num(p.settledAmount);
      if (v <= 0) continue;
      ledger.push({
        occurredAt: p.paidAt.toISOString(),
        kind: 'PAYABLE_SETTLED',
        direction: 'OUT',
        amount: v.toFixed(2),
        title: 'Quitação — contas a pagar (legado)',
        detail: [supplierDisplay(p.supplier), p.description].filter(Boolean).join(' — ') || p.description,
        methodLabel: paymentMethodLabel(p.paymentMethod),
        referentialAccountId: null,
        referentialAccountCode: null,
        referentialAccountLabel: null,
      });
    }

    for (const r of ledgerRecPaidLegacy) {
      if (!r.receivedAt) continue;
      const v = num(r.settledAmount);
      if (v <= 0) continue;
      ledger.push({
        occurredAt: r.receivedAt.toISOString(),
        kind: 'RECEIVABLE_SETTLED',
        direction: 'IN',
        amount: v.toFixed(2),
        title: 'Quitação — contas a receber (legado)',
        detail: [r.customer?.name, r.description].filter(Boolean).join(' — ') || r.description,
        methodLabel: paymentMethodLabel(r.paymentMethod),
        referentialAccountId: null,
        referentialAccountCode: null,
        referentialAccountLabel: null,
      });
    }

    ledger.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));

    const ledgerForResponse = costCenterFilter
      ? ledger.filter((row) =>
          rowMatchesSelectedCostCenter(
            {
              referentialAccountId: row.referentialAccountId,
              referentialAccountCode: row.referentialAccountCode,
            },
            costCenterFilter,
          ),
        )
      : ledger;
    const ledgerLines = ledgerForResponse.slice(0, 800);

    const movementsForResponse = costCenterFilter
      ? movementLines.filter((m) =>
          rowMatchesSelectedCostCenter(
            {
              referentialAccountId: m.referentialAccountId ?? null,
              referentialAccountCode: m.referentialAccountCode ?? null,
            },
            costCenterFilter,
          ),
        )
      : movementLines;

    let filteredCashFlow: { inflow: number; outflow: number; net: number } | null = null;
    if (costCenterFilter) {
      let inf = 0;
      let outf = 0;
      for (const row of ledgerForResponse) {
        const v = num(row.amount);
        if (row.direction === 'IN') inf += v;
        else if (row.direction === 'OUT') outf += v;
      }
      filteredCashFlow = { inflow: inf, outflow: outf, net: inf - outf };
    }

    const baseNotes = [
      'Diário: linhas INFO são títulos registrados (compromisso), não movimentação de caixa imediata.',
      'Pagamentos/recebimentos de títulos mostram o valor efetivo de cada liquidação (parcial ou total).',
      'Saídas/entradas pelo caixa aparecem como movimento de caixa; a linha de liquidação do título evita duplicar com o mesmo pagamento.',
      'Quitações antigas (antes da migração de liquidações) podem aparecer como “legado” se não houver histórico importado.',
    ];
    const notes =
      costCenterFilter != null
        ? [
            ...baseNotes,
            `Filtro ativo: centro de custo ${costCenterFilter.code} — ${costCenterFilter.description}.`,
            'Com filtro, entram linhas classificadas nesta conta ou em qualquer subconta (código do plano abaixo). Vendas no PDV não têm centro de custo e não entram no filtro.',
          ]
        : baseNotes;

    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        isCustomRange: periodIsCustom,
        label: periodIsCustom
          ? 'Período selecionado (relatório)'
          : 'Acumulado (desde 01/01/2026 ou primeiro registro financeiro)',
      },
      notes,
      costCenter: costCenterFilter,
      filteredCashFlow,
      storePosition: {
        cashLikeClosing: closingCashInferred,
        payablesOpen: payOpen,
        receivablesOpen: recOpen,
        /** Caixa inferido + a receber em aberto − a pagar em aberto (aproximação de posição). */
        approximatePosition: closingCashInferred + recOpen - payOpen,
      },
      ledger: ledgerLines,
      cash: {
        openingBalanceInferred: openingCashInferred,
        periodInflows,
        periodOutflows,
        closingBalanceInferred: closingCashInferred,
        openingByMethod: mapToArr(openingByMethod),
        periodByMethod: mapToArr(periodByMethod),
        periodByReasonBucket: mapToArr(periodByBucket),
        movements: movementsForResponse,
      },
      sales: {
        count: salesAgg._count._all,
        revenueTotal: num(salesAgg._sum.total),
      },
      payables: {
        newTitlesCount: payablesNewAgg._count._all,
        newTitlesAmount: num(payablesNewAgg._sum.amount),
        settledFullyInPeriodCount: payablesPaidPeriod._count._all,
        settledFullyInPeriodAmount: num(payablesPaidPeriod._sum.settledAmount),
        settledOffCashInPeriodAmount: num(payablesPaidOffCash._sum.settledAmount),
        openBalanceAmount: num(openPayables._sum.amountRemaining),
        openTitlesCount: openPayables._count._all,
      },
      receivables: {
        newTitlesCount: receivablesNewAgg._count._all,
        newTitlesAmount: num(receivablesNewAgg._sum.amount),
        settledFullyInPeriodCount: receivablesReceivedPeriod._count._all,
        settledFullyInPeriodAmount: num(receivablesReceivedPeriod._sum.settledAmount),
        settledOffCashInPeriodAmount: num(receivablesReceivedOffCash._sum.settledAmount),
        openBalanceAmount: num(openReceivables._sum.amountRemaining),
        openTitlesCount: openReceivables._count._all,
      },
    };
  }

  @Get('profitability')
  @Roles('admin', 'manager', 'finance')
  async profitability(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ) {
    if (!fromRaw || !toRaw) {
      throw new BadRequestException('Informe "from" e "to" (YYYY-MM-DD) para o relatório de rentabilidade.');
    }
    const from = parseQueryDate(fromRaw, 'start');
    const to = parseQueryDate(toRaw, 'end');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Datas inválidas em "from"/"to".');
    }
    if (from > to) {
      throw new BadRequestException('A data inicial deve ser anterior à data final.');
    }
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return buildProfitabilityReport(db, from, to, fromRaw, toRaw);
  }

  @Get('referential-accounts')
  @Roles('admin', 'manager', 'finance')
  async referentialAccounts(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('sourceVersion') sourceVersion?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const where: Prisma.ReferentialAccountWhereInput = {};
    if (sourceVersion != null && String(sourceVersion).trim() !== '') {
      where.sourceVersion = String(sourceVersion).trim();
    }
    if (search != null && String(search).trim() !== '') {
      const q = String(search).trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    return db.referentialAccount.findMany({
      where,
      orderBy: [{ sourceVersion: 'asc' }, { code: 'asc' }],
      take: 8000,
    });
  }
}
