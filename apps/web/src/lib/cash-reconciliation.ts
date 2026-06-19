/** Chaves analíticas — não entram no saldo apresentado (soma dos meios de recebimento). */
export const CASH_RECON_EXCLUDE_FROM_CLOSING_TOTAL = ['EXPENSE'] as const;

export type CashMovementBreakdown = {
  suprimentos: number;
  sangrias: number;
  despesas: number;
};

export function isExcludedFromClosingTotal(methodKey: string): boolean {
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
): number {
  if (!declared || typeof declared !== 'object') return 0;
  let sum = 0;
  for (const [key, raw] of Object.entries(declared)) {
    if (isExcludedFromClosingTotal(key)) continue;
    const n =
      typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) sum += Math.round(n * 100) / 100;
  }
  return Math.round(sum * 100) / 100;
}

/** Total apresentado (meios): prioriza rubricas gravadas na conferência. */
export function presentedTotalFromSession(
  closingByMethod: Record<string, number | string> | null | undefined,
  closingBalance: string | number | null | undefined,
): number | null {
  if (closingByMethod && typeof closingByMethod === 'object' && Object.keys(closingByMethod).length > 0) {
    return sumDeclaredForClosingBalance(closingByMethod);
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
