import {
  BillStatus,
  CashMovementType,
  CashSessionStatus,
  FiscalDocumentKind,
  FiscalDocumentStatus,
  PaymentMethod,
  PrismaClient,
  SaleStatus,
} from '../generated/tenant-client';
import {
  aggregateCompletedSalePayments,
  buildSessionExpectedByMethod,
} from '../cash/cash-session-expected';

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return round2((part / whole) * 100);
}

function paymentMethodLabel(m: PaymentMethod | string | null | undefined): string {
  if (!m) return '—';
  const map: Record<string, string> = {
    CASH: 'Dinheiro',
    CARD: 'Cartão',
    PIX: 'Pix',
    CREDIT: 'Crediário',
    OTHER: 'Outro',
    EXPENSE: 'Despesas',
  };
  return map[String(m)] ?? String(m);
}

function isOperatingExpenseAccountCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.trim();
  return c === '5' || c.startsWith('5.');
}

export type ProfitabilityDreLine = {
  id: string;
  label: string;
  amount: number | null;
  level: number;
  kind: 'REVENUE' | 'COST' | 'EXPENSE' | 'RESULT' | 'INFO';
};

export type ProfitabilityReport = {
  title: string;
  period: { from: string; to: string };
  methodology: string;
  dre: ProfitabilityDreLine[];
  indicators: {
    grossMarginPct: number | null;
    operatingMarginPct: number | null;
    fiscalCoveragePct: number | null;
    cashSalesSharePct: number | null;
    avgTicket: number | null;
  };
  sales: {
    count: number;
    grossRevenue: number;
    cogs: number;
    grossProfit: number;
    paymentsExcludingCredit: number;
  };
  fiscal: {
    nfceAuthorized: { count: number; total: number };
    nfcePending: { count: number; total: number };
    nfceRejectedOrError: { count: number; total: number };
    noFiscalDocument: { count: number; total: number };
    coveragePct: number | null;
  };
  cashRegisters: {
    sessionsClosedInPeriod: number;
    totalSalesInSessions: number;
    salesByMethod: Array<{ method: string; label: string; total: number }>;
    sessionExpenses: number;
  };
  expenses: {
    operatingTotal: number;
    fromCashExpenseMovements: number;
    fromPayableSettlements: number;
  };
  liquidity: {
    payablesOpen: number;
    receivablesOpen: number;
  };
  notes: string[];
};

async function computeCogsInPeriod(
  db: PrismaClient,
  from: Date,
  to: Date,
): Promise<number> {
  const items = await db.saleItem.findMany({
    where: {
      sale: {
        status: SaleStatus.COMPLETED,
        createdAt: { gte: from, lte: to },
      },
    },
    include: {
      variant: { select: { id: true, costAverage: true } },
      sale: { select: { createdAt: true } },
    },
  });
  if (!items.length) return 0;

  const variantIds = [...new Set(items.map((i) => i.variantId))];
  const costHistories = await db.productVariantPriceHistory.findMany({
    where: { variantId: { in: variantIds }, field: 'COST' },
    orderBy: [{ variantId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const histByVariant = new Map<string, typeof costHistories>();
  for (const h of costHistories) {
    if (!histByVariant.has(h.variantId)) histByVariant.set(h.variantId, []);
    histByVariant.get(h.variantId)!.push(h);
  }

  function unitCostAtSale(variantId: string, saleTime: Date, fallback: number): number {
    const list = histByVariant.get(variantId) ?? [];
    let unit = list.length > 0 ? num(list[0].previousValue) : fallback;
    for (const h of list) {
      if (h.createdAt.getTime() <= saleTime.getTime()) unit = num(h.newValue);
      else break;
    }
    return unit;
  }

  let cogs = 0;
  for (const it of items) {
    const qty = num(it.quantity);
    const cost = unitCostAtSale(it.variantId, it.sale.createdAt, num(it.variant.costAverage));
    cogs += qty * cost;
  }
  return round2(cogs);
}

export async function buildProfitabilityReport(
  db: PrismaClient,
  from: Date,
  to: Date,
  fromIso: string,
  toIso: string,
): Promise<ProfitabilityReport> {
  const [
    salesAgg,
    salePaymentsAgg,
    salesWithFiscal,
    closedSessions,
    periodSales,
    cashExpenseMovs,
    payableSettlements,
    openPayables,
    openReceivables,
  ] = await Promise.all([
    db.sale.aggregate({
      where: { status: SaleStatus.COMPLETED, createdAt: { gte: from, lte: to } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.salePayment.aggregate({
      where: {
        method: { not: PaymentMethod.CREDIT },
        sale: { status: SaleStatus.COMPLETED, createdAt: { gte: from, lte: to } },
      },
      _sum: { amount: true },
    }),
    db.sale.findMany({
      where: { status: SaleStatus.COMPLETED, createdAt: { gte: from, lte: to } },
      select: {
        total: true,
        fiscalDocument: { select: { kind: true, status: true } },
      },
    }),
    db.cashRegisterSession.findMany({
      where: {
        status: CashSessionStatus.CLOSED,
        closedAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        controlNumber: true,
        openedAt: true,
        closedAt: true,
        movements: { select: { type: true, amount: true, method: true } },
      },
    }),
    db.sale.findMany({
      where: { status: SaleStatus.COMPLETED, createdAt: { gte: from, lte: to } },
      select: {
        total: true,
        createdAt: true,
        status: true,
        payments: { select: { method: true, amount: true } },
      },
    }),
    db.cashMovement.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        type: CashMovementType.OUT,
        OR: [
          { method: PaymentMethod.EXPENSE },
          { referentialAccount: { OR: [{ code: '5' }, { code: { startsWith: '5.' } }] } },
        ],
      },
      select: { amount: true },
    }),
    db.payableSettlement.findMany({
      where: { paidAt: { gte: from, lte: to } },
      select: {
        amount: true,
        referentialAccount: { select: { code: true } },
      },
    }),
    db.accountPayable.aggregate({
      where: { status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] } },
      _sum: { amountRemaining: true },
    }),
    db.accountReceivable.aggregate({
      where: { status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] } },
      _sum: { amountRemaining: true },
    }),
  ]);

  const grossRevenue = round2(num(salesAgg._sum.total));
  const salesCount = salesAgg._count._all;
  const paymentsExcludingCredit = round2(num(salePaymentsAgg._sum.amount));
  const cogs = await computeCogsInPeriod(db, from, to);
  const grossProfit = round2(grossRevenue - cogs);

  const fiscalBuckets = {
    nfceAuthorized: { count: 0, total: 0 },
    nfcePending: { count: 0, total: 0 },
    nfceRejectedOrError: { count: 0, total: 0 },
    noFiscalDocument: { count: 0, total: 0 },
  };

  for (const s of salesWithFiscal) {
    const total = num(s.total);
    const doc = s.fiscalDocument;
    if (!doc) {
      fiscalBuckets.noFiscalDocument.count += 1;
      fiscalBuckets.noFiscalDocument.total += total;
      continue;
    }
    if (doc.kind !== FiscalDocumentKind.NFC_E) {
      fiscalBuckets.noFiscalDocument.count += 1;
      fiscalBuckets.noFiscalDocument.total += total;
      continue;
    }
    if (doc.status === FiscalDocumentStatus.AUTHORIZED) {
      fiscalBuckets.nfceAuthorized.count += 1;
      fiscalBuckets.nfceAuthorized.total += total;
    } else if (
      doc.status === FiscalDocumentStatus.REJECTED ||
      doc.status === FiscalDocumentStatus.ERROR ||
      doc.status === FiscalDocumentStatus.CANCELLED
    ) {
      fiscalBuckets.nfceRejectedOrError.count += 1;
      fiscalBuckets.nfceRejectedOrError.total += total;
    } else {
      fiscalBuckets.nfcePending.count += 1;
      fiscalBuckets.nfcePending.total += total;
    }
  }

  for (const key of Object.keys(fiscalBuckets) as Array<keyof typeof fiscalBuckets>) {
    fiscalBuckets[key].total = round2(fiscalBuckets[key].total);
  }

  const salesByMethodMap = new Map<string, number>();
  let totalSalesInSessions = 0;
  let sessionExpenses = 0;

  for (const session of closedSessions) {
    const upper = session.closedAt ?? to;
    const sessionSales = periodSales.filter(
      (s) => s.createdAt >= session.openedAt && s.createdAt <= upper,
    );
    let sessionTotal = 0;
    for (const s of sessionSales) {
      sessionTotal += num(s.total);
    }
    totalSalesInSessions += sessionTotal;

    const { movementBreakdown } = buildSessionExpectedByMethod(sessionSales, session.movements);
    sessionExpenses += movementBreakdown.despesas;

    const byMethod = aggregateCompletedSalePayments(sessionSales);
    for (const [method, v] of byMethod) {
      salesByMethodMap.set(method, (salesByMethodMap.get(method) ?? 0) + v);
    }
  }

  totalSalesInSessions = round2(totalSalesInSessions);
  sessionExpenses = round2(sessionExpenses);

  const salesByMethod = [...salesByMethodMap.entries()]
    .map(([method, total]) => ({
      method,
      label: paymentMethodLabel(method),
      total: round2(total),
    }))
    .sort((a, b) => b.total - a.total);

  let fromCashExpenseMovements = 0;
  for (const m of cashExpenseMovs) {
    fromCashExpenseMovements += num(m.amount);
  }
  fromCashExpenseMovements = round2(fromCashExpenseMovements);

  let fromPayableSettlements = 0;
  for (const s of payableSettlements) {
    if (!isOperatingExpenseAccountCode(s.referentialAccount?.code)) continue;
    fromPayableSettlements += num(s.amount);
  }
  fromPayableSettlements = round2(fromPayableSettlements);

  const operatingTotal = round2(fromCashExpenseMovements + fromPayableSettlements);
  const operatingResult = round2(grossProfit - operatingTotal);

  const grossMarginPct = pct(grossProfit, grossRevenue);
  const operatingMarginPct = pct(operatingResult, grossRevenue);
  const fiscalCoveragePct = pct(fiscalBuckets.nfceAuthorized.total, grossRevenue);
  const cashSalesSharePct = pct(paymentsExcludingCredit, grossRevenue);
  const avgTicket = salesCount > 0 ? round2(grossRevenue / salesCount) : null;

  const dre: ProfitabilityDreLine[] = [
    {
      id: 'revenue',
      label: '(+) Receita bruta de vendas',
      amount: grossRevenue,
      level: 0,
      kind: 'REVENUE',
    },
    {
      id: 'revenue-cash',
      label: 'Recebimentos no caixa/PDV (exc. crediário)',
      amount: paymentsExcludingCredit,
      level: 1,
      kind: 'INFO',
    },
    {
      id: 'revenue-fiscal',
      label: 'NFC-e autorizadas (referência fiscal)',
      amount: fiscalBuckets.nfceAuthorized.total,
      level: 1,
      kind: 'INFO',
    },
    {
      id: 'cogs',
      label: '(−) CMV — custo das mercadorias vendidas',
      amount: cogs,
      level: 0,
      kind: 'COST',
    },
    {
      id: 'gross-profit',
      label: '(=) Lucro bruto',
      amount: grossProfit,
      level: 0,
      kind: 'RESULT',
    },
    {
      id: 'gross-margin',
      label: 'Margem bruta sobre vendas',
      amount: grossMarginPct,
      level: 1,
      kind: 'INFO',
    },
    {
      id: 'opex',
      label: '(−) Despesas operacionais (caixa + títulos 5.x)',
      amount: operatingTotal,
      level: 0,
      kind: 'EXPENSE',
    },
    {
      id: 'opex-cash',
      label: 'Despesas de caixa (mov. EXPENSE)',
      amount: fromCashExpenseMovements,
      level: 1,
      kind: 'INFO',
    },
    {
      id: 'opex-payables',
      label: 'Pagamentos classificados no plano 5.x',
      amount: fromPayableSettlements,
      level: 1,
      kind: 'INFO',
    },
    {
      id: 'operating-result',
      label: '(=) Resultado operacional estimado',
      amount: operatingResult,
      level: 0,
      kind: 'RESULT',
    },
    {
      id: 'operating-margin',
      label: 'Margem operacional sobre vendas',
      amount: operatingMarginPct,
      level: 1,
      kind: 'INFO',
    },
  ];

  const notes = [
    'Demonstração gerencial simplificada (estrutura inspirada na DRE — CPC 26 / análise de lucratividade). Não substitui escrituração contábil ou SPED.',
    'Receita: vendas concluídas no período. CMV: custo médio vigente na data de cada venda (histórico de custo ou custo médio da SKU).',
    'Despesas operacionais: saídas de caixa tipo EXPENSE e liquidações de contas a pagar vinculadas a contas do grupo 5 do plano referencial.',
    'NFC-e autorizadas: vendas com documento fiscal eletrônico consumidor em status AUTHORIZED — indicador de conformidade fiscal do faturamento.',
    'Caixas: sessões fechadas no período; vendas alocadas pela data da venda dentro da janela [abertura, fechamento] de cada sessão.',
  ];

  return {
    title: 'Rentabilidade',
    period: { from: fromIso, to: toIso },
    methodology:
      'Indicadores de saúde financeira com receita de vendas, CMV, margem bruta, despesas operacionais e cobertura de NFC-e autorizadas, ' +
      'confrontando faturamento registrado com recebimentos no caixa e totais das sessões de PDV fechadas.',
    dre,
    indicators: {
      grossMarginPct,
      operatingMarginPct,
      fiscalCoveragePct,
      cashSalesSharePct,
      avgTicket,
    },
    sales: {
      count: salesCount,
      grossRevenue,
      cogs,
      grossProfit,
      paymentsExcludingCredit,
    },
    fiscal: {
      ...fiscalBuckets,
      coveragePct: fiscalCoveragePct,
    },
    cashRegisters: {
      sessionsClosedInPeriod: closedSessions.length,
      totalSalesInSessions,
      salesByMethod,
      sessionExpenses,
    },
    expenses: {
      operatingTotal,
      fromCashExpenseMovements,
      fromPayableSettlements,
    },
    liquidity: {
      payablesOpen: round2(num(openPayables._sum.amountRemaining)),
      receivablesOpen: round2(num(openReceivables._sum.amountRemaining)),
    },
    notes,
  };
}
