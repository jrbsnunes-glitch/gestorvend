/** Chaves analíticas — não entram no saldo apresentado (soma dos meios de recebimento). */
export const CASH_RECON_EXCLUDE_FROM_CLOSING_TOTAL = ['EXPENSE'] as const;

export type CashMovementBreakdown = {
  suprimentos: number;
  sangrias: number;
  despesas: number;
};

export type CashReconClosingOptions = {
  /** Quando true, despesas (EXPENSE) entram no total apresentado na conferência. */
  includeExpenseInPresentedTotal?: boolean;
};

export function isExcludedFromClosingTotal(
  methodKey: string,
  options?: CashReconClosingOptions,
): boolean {
  if (methodKey === 'EXPENSE' && options?.includeExpenseInPresentedTotal) return false;
  return (CASH_RECON_EXCLUDE_FROM_CLOSING_TOTAL as readonly string[]).includes(methodKey);
}

/** Esperado na conciliação — dinheiro inclui fundo inicial (movimentos já líquidos em `expected.CASH`). */
export function expectedFinalForReconKey(
  key: string,
  expected: Record<string, number>,
  opening: number,
): number {
  const base = expected[key] ?? 0;
  return key === 'CASH' ? Math.round((base + opening) * 100) / 100 : base;
}

export function sumDeclaredForClosingBalance(
  declared: Record<string, number | string> | null | undefined,
  options?: CashReconClosingOptions,
): number {
  if (!declared || typeof declared !== 'object') return 0;
  let sum = 0;
  for (const [key, raw] of Object.entries(declared)) {
    if (isExcludedFromClosingTotal(key, options)) continue;
    const n =
      typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) sum += Math.round(n * 100) / 100;
  }
  return Math.round(sum * 100) / 100;
}

export function sumPaymentMethodsTotal(
  byMethod: Record<string, number | string> | null | undefined,
  options?: CashReconClosingOptions,
): number {
  if (!byMethod || typeof byMethod !== 'object') return 0;
  let sum = 0;
  for (const [key, raw] of Object.entries(byMethod)) {
    if (isExcludedFromClosingTotal(key, options)) continue;
    const n =
      typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(',', '.'));
    if (Number.isFinite(n)) sum += Math.round(n * 100) / 100;
  }
  return Math.round(sum * 100) / 100;
}

/** Total apresentado (meios): prioriza rubricas gravadas na conferência. */
export function presentedTotalFromSession(
  closingByMethod: Record<string, number | string> | null | undefined,
  closingBalance: string | number | null | undefined,
  options?: CashReconClosingOptions,
): number | null {
  if (closingByMethod && typeof closingByMethod === 'object' && Object.keys(closingByMethod).length > 0) {
    return sumDeclaredForClosingBalance(closingByMethod, options);
  }
  if (closingBalance != null && closingBalance !== '') {
    const n =
      typeof closingBalance === 'number'
        ? closingBalance
        : parseFloat(String(closingBalance).replace(',', '.'));
    if (Number.isFinite(n)) return Math.round(n * 100) / 100;
  }
  return null;
}

export function formatCashExpectedHint(
  opening: number,
  breakdown?: CashMovementBreakdown | null,
): string {
  const parts: string[] = [`fundo ${formatHintMoney(opening)}`];
  if (breakdown) {
    if (breakdown.suprimentos > 0) parts.push(`+ supr. ${formatHintMoney(breakdown.suprimentos)}`);
    if (breakdown.sangrias > 0) parts.push(`− sangria ${formatHintMoney(breakdown.sangrias)}`);
    if (breakdown.despesas > 0) parts.push(`− despesa ${formatHintMoney(breakdown.despesas)}`);
  }
  return parts.join(' · ');
}

function formatHintMoney(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function expensePresentedTotalHint(includeExpenseInPresentedTotal: boolean): string {
  return includeExpenseInPresentedTotal
    ? 'soma no total apresentado (dinheiro + despesa = vendas em dinheiro)'
    : 'analítico — não entra no total apresentado';
}

export function reconciliationTotalLabel(includeExpenseInPresentedTotal: boolean): {
  title: string;
  subtitle: string;
} {
  return includeExpenseInPresentedTotal
    ? {
        title: 'Total apresentado',
        subtitle: 'inclui despesas do caixa',
      }
    : {
        title: 'Total (meios)',
        subtitle: 'sem linha de despesas',
      };
}

export function sumReconciliationTotals(
  rows: Array<{ key: string; expectedFinal: number; declaredVal: number | null }>,
  includeExpenseInTotal: boolean,
): { totalExpected: number; totalDeclared: number } {
  let totalExpected = 0;
  let totalDeclared = 0;
  for (const r of rows) {
    if (!includeExpenseInTotal && isExcludedFromClosingTotal(r.key)) continue;
    totalExpected += r.expectedFinal;
    totalDeclared += r.declaredVal ?? 0;
  }
  return {
    totalExpected: Math.round(totalExpected * 100) / 100,
    totalDeclared: Math.round(totalDeclared * 100) / 100,
  };
}

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Quando a despesa é analítica, explica diferença em dinheiro ≈ valor da despesa. */
export type CashExpenseDiffExplain = {
  expenseAmount: number;
  cashDiff: number;
  /** Apresentado em dinheiro − esperado ≈ despesa (informou vendas brutas em dinheiro). */
  expenseExplainsCashDiff: boolean;
  /** Dinheiro apresentado + despesa apresentada ≈ vendas brutas em dinheiro. */
  cashPlusExpenseMatchesGross: boolean;
  grossCashSales: number;
};

export function analyzeCashExpenseDiff(params: {
  includeExpenseInPresentedTotal: boolean;
  cashExpected: number;
  cashDeclared: number | null;
  expenseExpected: number;
  expenseDeclared: number | null;
  grossCashSales?: number;
}): CashExpenseDiffExplain | null {
  if (params.includeExpenseInPresentedTotal) return null;
  const expenseAmount = roundMoney2(params.expenseExpected);
  if (expenseAmount <= 0) return null;
  if (params.cashDeclared == null) return null;

  const cashDiff = roundMoney2(params.cashDeclared - params.cashExpected);
  const grossCashSales = roundMoney2(
    params.grossCashSales ?? params.cashExpected + expenseAmount,
  );
  const expenseDeclared = params.expenseDeclared ?? 0;

  const expenseExplainsCashDiff = Math.abs(cashDiff - expenseAmount) < 0.01;
  const cashPlusExpenseMatchesGross =
    Math.abs(params.cashDeclared + expenseDeclared - grossCashSales) < 0.01;

  if (!expenseExplainsCashDiff && !cashPlusExpenseMatchesGross) return null;

  return {
    expenseAmount,
    cashDiff,
    expenseExplainsCashDiff,
    cashPlusExpenseMatchesGross,
    grossCashSales,
  };
}

export function cashExpenseExplainMessage(explain: CashExpenseDiffExplain): string {
  if (explain.cashPlusExpenseMatchesGross) {
    return `Conferido: dinheiro + despesa = vendas em dinheiro (${formatHintMoney(explain.grossCashSales)}).`;
  }
  if (explain.expenseExplainsCashDiff) {
    return `Diferença de ${formatHintMoney(explain.cashDiff)} = despesa retirada — caixa conferido (informou o total em dinheiro das vendas).`;
  }
  return '';
}

export type ReconDiffTone = 'ok' | 'over' | 'short' | 'neutral' | 'explained';

/** Rótulo da diferença; trata despesa analítica que explica o gap em dinheiro. */
export function reconDiffDisplay(
  diff: number | null,
  cashExpenseExplain: CashExpenseDiffExplain | null,
  forCashRow = false,
): { label: string; tone: ReconDiffTone; explainNote: string | null } {
  if (diff == null) return { label: '—', tone: 'neutral', explainNote: null };
  if (Math.abs(diff) < 0.005) return { label: 'OK', tone: 'ok', explainNote: null };
  if (forCashRow && cashExpenseExplain) {
    return {
      label: 'OK',
      tone: 'explained',
      explainNote: cashExpenseExplainMessage(cashExpenseExplain),
    };
  }
  return {
    label: (diff > 0 ? '+' : '') + formatHintMoney(diff),
    tone: diff > 0 ? 'over' : 'short',
    explainNote: null,
  };
}

export function analyticalExpenseReconFootnote(expenseAmount: number): string | null {
  if (expenseAmount <= 0) return null;
  return `Despesas analíticas (${formatHintMoney(expenseAmount)}) não entram no total esperado de meios — somam ao registrado em vendas.`;
}
