export function ledgerDirectionLabel(d: 'IN' | 'OUT' | 'INFO'): string {
  if (d === 'IN') return 'Entrada';
  if (d === 'OUT') return 'Saída';
  return 'Registro';
}

export function ledgerKindLabel(kind: string): string {
  const map: Record<string, string> = {
    CASH_MOVEMENT: 'Caixa',
    SALE_PAYMENT: 'Venda',
    PAYABLE_REGISTERED: 'A pagar (novo)',
    RECEIVABLE_REGISTERED: 'A receber (novo)',
    PAYABLE_SETTLED: 'Pagamento título',
    RECEIVABLE_SETTLED: 'Recebimento título',
    PAYABLE_PAYMENT: 'Pagamento a pagar',
    RECEIVABLE_PAYMENT: 'Recebimento a receber',
  };
  return map[kind] ?? kind;
}
