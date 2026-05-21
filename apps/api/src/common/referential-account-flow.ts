/**
 * Regras de “centro de custo” a partir do código do plano referencial (amostra RFB):
 * - Despesa de caixa (EXPENSE): grupos 4 (custos) e 5 (despesas) apenas.
 * - Pagamento de contas a pagar: qualquer conta exceto receitas (grupo 6).
 * - Recebimentos: grupo 6 (receitas).
 */
export type ReferentialAccountFlow = 'IN' | 'OUT';

export function referentialCodeMatchesFlow(code: string, flow: ReferentialAccountFlow): boolean {
  const c = String(code ?? '').trim();
  if (!c) return false;
  if (flow === 'OUT') {
    return c === '4' || c.startsWith('4.') || c === '5' || c.startsWith('5.');
  }
  return c === '6' || c.startsWith('6.');
}

/**
 * Classificação em liquidação de conta a pagar: todo o plano referencial,
 * exceto contas de receita (código 6 e subcontas).
 */
export function referentialCodeAllowedForPayableCostCenter(code: string): boolean {
  const c = String(code ?? '').trim();
  if (!c) return false;
  if (c === '6' || c.startsWith('6.')) return false;
  return true;
}

/**
 * Verdadeiro se `rowCode` é a conta do centro ou uma subconta (prefixo de código no plano).
 */
export function referentialCodeUnderCenter(
  rowCode: string | null | undefined,
  centerCode: string,
): boolean {
  const rc = String(rowCode ?? '').trim();
  const cc = String(centerCode ?? '').trim();
  if (!rc || !cc) return false;
  return rc === cc || rc.startsWith(`${cc}.`);
}

export function rowMatchesSelectedCostCenter(
  row: { referentialAccountId: string | null; referentialAccountCode: string | null },
  center: { id: string; code: string },
): boolean {
  if (row.referentialAccountId === center.id) return true;
  if (!row.referentialAccountCode) return false;
  return referentialCodeUnderCenter(row.referentialAccountCode, center.code);
}
