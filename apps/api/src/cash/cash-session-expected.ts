import {
  CashMovementType,
  PaymentMethod,
  SaleStatus,
} from '../generated/tenant-client';
import { roundMoney, splitSalePayments } from '../sales/sales-payment-breakdown.util';

/** Chaves analíticas — não entram no saldo apresentado (soma dos meios de recebimento). */
export const CASH_RECON_EXCLUDE_FROM_CLOSING_TOTAL = ['EXPENSE'] as const;

export type CashReconClosingOptions = {
  /** Quando true, despesas (EXPENSE) entram no total apresentado na conferência. */
  includeExpenseInPresentedTotal?: boolean;
};

export type CashMovementForExpected = {
  type: CashMovementType;
  amount: unknown;
  method: PaymentMethod | null;
};

export type SalePaymentForCashReport = {
  method: string;
  amount: unknown;
  cardOperation?: string | null;
  paymentForm?: {
    name: string;
    kind?: string | null;
    cardOperation?: string | null;
  } | null;
};

export type CashSaleForExpected = {
  status: SaleStatus;
  total?: unknown;
  number?: number;
  id?: string;
  createdAt?: Date;
  payments: Array<{ method: string; amount: unknown } & Partial<SalePaymentForCashReport>>;
};

export type CashPaymentBreakdownRow = {
  key: string;
  label: string;
  amount: number;
  deferredReceipt: boolean;
};

export type CancelledSaleReportRow = {
  id: string;
  number: number;
  createdAt: string;
  total: number;
};

/** Pagamentos que não entram no caixa na hora da venda (título a receber). */
export const DEFERRED_SALE_PAYMENT_METHODS = [
  PaymentMethod.CREDIT,
  PaymentMethod.REQUISITION,
] as const;

export function isDeferredSalePaymentMethod(method: string): boolean {
  return (
    method === PaymentMethod.CREDIT || method === PaymentMethod.REQUISITION
  );
}

export type CompletedSalesTotals = {
  /** Soma dos totais das vendas concluídas (faturamento). */
  totalInvoiced: number;
  /** Pagamentos na venda exceto requisição (inclui saldo crediário). */
  totalReceivedAtSale: number;
  /** Só requisição (título a receber). */
  totalRequisitionAtSale: number;
  /** Saldo crediário consumido na venda. */
  totalCreditAtSale: number;
  /** Crediário + requisição (legado / conferência de caixa). */
  totalDeferred: number;
};

export function aggregateCompletedSalesTotals(
  sales: CashSaleForExpected[],
): CompletedSalesTotals {
  let totalInvoiced = 0;
  let totalReceivedAtSale = 0;
  let totalRequisitionAtSale = 0;
  let totalCreditAtSale = 0;
  for (const sale of sales) {
    if (sale.status !== SaleStatus.COMPLETED) continue;
    totalInvoiced += Number(sale.total ?? 0);
    const split = splitSalePayments(sale.payments);
    totalReceivedAtSale += split.receivedAtSale;
    totalRequisitionAtSale += split.requisitionAtSale;
    totalCreditAtSale += split.creditFromBalance;
  }
  const totalDeferred = roundMoney(totalRequisitionAtSale + totalCreditAtSale);
  return {
    totalInvoiced: roundMoney(totalInvoiced),
    totalReceivedAtSale: roundMoney(totalReceivedAtSale),
    totalRequisitionAtSale: roundMoney(totalRequisitionAtSale),
    totalCreditAtSale: roundMoney(totalCreditAtSale),
    totalDeferred,
  };
}

export type CashMovementBreakdown = {
  suprimentos: number;
  sangrias: number;
  despesas: number;
};

/** Soma pagamentos de vendas concluídas por forma. */
export function aggregateCompletedSalePayments(
  sales: CashSaleForExpected[],
): Map<string, number> {
  const byMethod = new Map<string, number>();
  for (const sale of sales) {
    if (sale.status !== SaleStatus.COMPLETED) continue;
    for (const p of sale.payments) {
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount));
    }
  }
  return byMethod;
}

/**
 * Ajusta o esperado em dinheiro com movimentos da sessão:
 * suprimento (+), sangria (−) e despesa (− dinheiro + bucket EXPENSE).
 */
export function applyCashMovementsToExpected(
  byMethod: Map<string, number>,
  movements: CashMovementForExpected[],
): CashMovementBreakdown {
  let suprimentos = 0;
  let sangrias = 0;
  let despesas = 0;

  for (const m of movements) {
    const v = Number(m.amount);
    if (!Number.isFinite(v) || v <= 0) continue;

    if (m.type === CashMovementType.IN) {
      suprimentos += v;
      byMethod.set('CASH', (byMethod.get('CASH') ?? 0) + v);
      continue;
    }

    if (m.type !== CashMovementType.OUT) continue;

    if (m.method === PaymentMethod.EXPENSE) {
      despesas += v;
      byMethod.set('EXPENSE', (byMethod.get('EXPENSE') ?? 0) + v);
      byMethod.set('CASH', (byMethod.get('CASH') ?? 0) - v);
    } else {
      sangrias += v;
      byMethod.set('CASH', (byMethod.get('CASH') ?? 0) - v);
    }
  }

  return {
    suprimentos: roundMoney(suprimentos),
    sangrias: roundMoney(sangrias),
    despesas: roundMoney(despesas),
  };
}

function mapToRoundedRecord(map: Map<string, number>): Record<string, number> {
  const byMethod: Record<string, number> = {};
  for (const [k, v] of map.entries()) {
    const rounded = roundMoney(v);
    if (Math.abs(rounded) >= 0.005) byMethod[k] = rounded;
  }
  return byMethod;
}

/** Pagamentos registrados nas vendas concluídas, por forma (sem fundo, sangria ou suprimento). */
export function buildSalesByMethod(sales: CashSaleForExpected[]): Record<string, number> {
  return mapToRoundedRecord(aggregateCompletedSalePayments(sales));
}

function cardOpDebit(cardOperation?: string | null): boolean {
  return String(cardOperation ?? '').trim().toUpperCase() === 'DEBIT';
}

export function salePaymentGroupKey(p: SalePaymentForCashReport): string {
  const formName = p.paymentForm?.name?.trim();
  if (formName) return formName;
  if (p.method === PaymentMethod.CARD) {
    return cardOpDebit(p.cardOperation) ? 'CARD_DEBIT' : 'CARD_CREDIT';
  }
  return p.method;
}

export function salePaymentGroupLabel(key: string, p?: SalePaymentForCashReport): string {
  if (p?.paymentForm?.name?.trim()) return p.paymentForm.name.trim();
  if (key === 'CARD_CREDIT') return 'Cartão de crédito';
  if (key === 'CARD_DEBIT') return 'Cartão de débito';
  const labels: Record<string, string> = {
    CASH: 'Dinheiro',
    CARD: 'Cartão',
    PIX: 'Pix',
    CREDIT: 'Saldo crediário',
    REQUISITION: 'Requisição',
    OTHER: 'Outro',
  };
  return labels[key] ?? key;
}

export function isDeferredSaleReceiptKey(key: string, p?: SalePaymentForCashReport): boolean {
  if (key === PaymentMethod.REQUISITION || key === PaymentMethod.CREDIT) return true;
  if (key === 'CARD_CREDIT') return true;
  const kind = String(p?.paymentForm?.kind ?? '').toUpperCase();
  if (kind === 'REQUISITION' || kind === 'CREDIT') return true;
  if (kind === 'CARD') {
    const op = p?.paymentForm?.cardOperation ?? p?.cardOperation;
    return !cardOpDebit(op);
  }
  return false;
}

/** Vendas concluídas agrupadas por forma cadastrada ou método (cartão crédito/débito). */
export function buildSalesByPaymentForm(
  sales: Array<{ status: SaleStatus; payments: SalePaymentForCashReport[] }>,
): Record<string, number> {
  const map = new Map<string, number>();
  for (const sale of sales) {
    if (sale.status !== SaleStatus.COMPLETED) continue;
    for (const p of sale.payments) {
      const key = salePaymentGroupKey(p);
      map.set(key, (map.get(key) ?? 0) + Number(p.amount));
    }
  }
  return mapToRoundedRecord(map);
}

const BREAKDOWN_SORT_ORDER = [
  'CASH',
  'PIX',
  'CARD_DEBIT',
  'CARD_CREDIT',
  'CREDIT',
  'REQUISITION',
  'OTHER',
] as const;

export function buildSalesByPaymentBreakdown(
  sales: Array<{ status: SaleStatus; payments: SalePaymentForCashReport[] }>,
): CashPaymentBreakdownRow[] {
  const map = new Map<
    string,
    { amount: number; label: string; deferredReceipt: boolean }
  >();
  for (const sale of sales) {
    if (sale.status !== SaleStatus.COMPLETED) continue;
    for (const p of sale.payments) {
      const key = salePaymentGroupKey(p);
      const prev = map.get(key);
      const add = Number(p.amount);
      if (!Number.isFinite(add) || add <= 0) continue;
      const label = salePaymentGroupLabel(key, p);
      const deferredReceipt = isDeferredSaleReceiptKey(key, p);
      if (prev) {
        prev.amount += add;
      } else {
        map.set(key, { amount: add, label, deferredReceipt });
      }
    }
  }
  const rows: CashPaymentBreakdownRow[] = [];
  for (const [key, v] of map.entries()) {
    rows.push({
      key,
      label: v.label,
      amount: roundMoney(v.amount),
      deferredReceipt: v.deferredReceipt,
    });
  }
  return sortPaymentBreakdownRows(rows);
}

export function sortPaymentBreakdownRows(rows: CashPaymentBreakdownRow[]): CashPaymentBreakdownRow[] {
  return [...rows].sort((a, b) => {
    const ai = BREAKDOWN_SORT_ORDER.indexOf(a.key as (typeof BREAKDOWN_SORT_ORDER)[number]);
    const bi = BREAKDOWN_SORT_ORDER.indexOf(b.key as (typeof BREAKDOWN_SORT_ORDER)[number]);
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label, 'pt-BR');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    if (ai !== bi) return ai - bi;
    return a.label.localeCompare(b.label, 'pt-BR');
  });
}

export function mergePaymentBreakdownRows(
  target: CashPaymentBreakdownRow[],
  add: CashPaymentBreakdownRow[],
): CashPaymentBreakdownRow[] {
  const map = new Map<string, CashPaymentBreakdownRow>();
  for (const row of [...target, ...add]) {
    const prev = map.get(row.key);
    if (prev) {
      prev.amount = roundMoney(prev.amount + row.amount);
      prev.deferredReceipt = prev.deferredReceipt || row.deferredReceipt;
    } else {
      map.set(row.key, { ...row });
    }
  }
  return sortPaymentBreakdownRows([...map.values()]);
}

export function collectCancelledSales(
  sales: CashSaleForExpected[],
): CancelledSaleReportRow[] {
  return sales
    .filter((s) => s.status === SaleStatus.CANCELLED)
    .map((s) => ({
      id: String(s.id ?? ''),
      number: Number(s.number ?? 0),
      createdAt: (s.createdAt instanceof Date ? s.createdAt : new Date()).toISOString(),
      total: roundMoney(Number(s.total ?? 0)),
    }))
    .filter((r) => r.id && r.number > 0)
    .sort((a, b) => a.number - b.number);
}

export function buildSessionExpectedByMethod(
  sales: CashSaleForExpected[],
  movements: CashMovementForExpected[],
): { byMethod: Record<string, number>; movementBreakdown: CashMovementBreakdown } {
  const map = aggregateCompletedSalePayments(sales);
  const movementBreakdown = applyCashMovementsToExpected(map, movements);
  return { byMethod: mapToRoundedRecord(map), movementBreakdown };
}

export function expectedFinalForMethodKey(
  key: string,
  expected: Record<string, number>,
  opening: number,
): number {
  const base = expected[key] ?? 0;
  return key === 'CASH' ? roundMoney(base + opening) : base;
}

export function isExcludedFromClosingTotal(
  methodKey: string,
  options?: CashReconClosingOptions,
): boolean {
  if (isDeferredSalePaymentMethod(methodKey)) return true;
  if (methodKey === PaymentMethod.EXPENSE && options?.includeExpenseInPresentedTotal) {
    return false;
  }
  return (CASH_RECON_EXCLUDE_FROM_CLOSING_TOTAL as readonly string[]).includes(
    methodKey,
  );
}

/** Total apresentado operacional (meios de recebimento; despesas opcionais). */
export function computeClosingBalanceFromDeclared(
  declared: Record<string, number>,
  options?: CashReconClosingOptions,
): number {
  return roundMoney(
    Object.entries(declared).reduce(
      (acc, [key, val]) =>
        isExcludedFromClosingTotal(key, options) ? acc : acc + val,
      0,
    ),
  );
}

export function computeReconciliationDifference(
  expected: Record<string, number>,
  declared: Record<string, number> | null | undefined,
  opening: number,
  options?: CashReconClosingOptions,
): number | null {
  if (!declared) return null;

  const methodKeys = Array.from(
    new Set([...Object.keys(expected), ...Object.keys(declared), 'CASH']),
  );

  let totalExpected = 0;
  let totalDeclared = 0;
  let anyVisibleRow = false;

  for (const key of methodKeys) {
    if (isExcludedFromClosingTotal(key, options)) continue;

    const expectedFinal = expectedFinalForMethodKey(key, expected, opening);
    const rawDeclared = declared[key];
    const declaredVal =
      rawDeclared == null
        ? null
        : typeof rawDeclared === 'number'
          ? rawDeclared
          : parseFloat(String(rawDeclared).replace(',', '.'));

    if (!(expectedFinal > 0 || declaredVal != null)) continue;
    anyVisibleRow = true;
    totalExpected += expectedFinal;
    totalDeclared += declaredVal ?? 0;
  }

  return anyVisibleRow ? roundMoney(totalDeclared - totalExpected) : null;
}
