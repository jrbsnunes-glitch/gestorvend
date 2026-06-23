import {
  CashMovementType,
  PaymentMethod,
  SaleStatus,
} from '../generated/tenant-client';

/** Chaves analíticas — não entram no saldo apresentado (soma dos meios de recebimento). */
export const CASH_RECON_EXCLUDE_FROM_CLOSING_TOTAL = ['EXPENSE'] as const;

export type CashMovementForExpected = {
  type: CashMovementType;
  amount: unknown;
  method: PaymentMethod | null;
};

export type CashSaleForExpected = {
  status: SaleStatus;
  payments: Array<{ method: string; amount: unknown }>;
};

export type CashMovementBreakdown = {
  suprimentos: number;
  sangrias: number;
  despesas: number;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

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

export function isExcludedFromClosingTotal(methodKey: string): boolean {
  return (CASH_RECON_EXCLUDE_FROM_CLOSING_TOTAL as readonly string[]).includes(methodKey);
}

/** Total apresentado operacional (meios de recebimento; sem despesas analíticas). */
export function computeClosingBalanceFromDeclared(
  declared: Record<string, number>,
): number {
  return roundMoney(
    Object.entries(declared).reduce(
      (acc, [key, val]) => (isExcludedFromClosingTotal(key) ? acc : acc + val),
      0,
    ),
  );
}

export function computeReconciliationDifference(
  expected: Record<string, number>,
  declared: Record<string, number> | null | undefined,
  opening: number,
): number | null {
  if (!declared) return null;

  const methodKeys = Array.from(
    new Set([...Object.keys(expected), ...Object.keys(declared), 'CASH']),
  );

  let totalExpected = 0;
  let totalDeclared = 0;
  let anyVisibleRow = false;

  for (const key of methodKeys) {
    if (isExcludedFromClosingTotal(key)) continue;

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
