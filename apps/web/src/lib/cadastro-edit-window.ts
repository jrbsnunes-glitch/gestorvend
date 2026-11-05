/** Abre cadastro em nova aba (correção fiscal sem perder a nota na aba atual). */
export function openCustomerCadastro(customerId: string): void {
  const q = new URLSearchParams({ edit: customerId });
  window.open(`/clientes?${q.toString()}`, '_blank', 'noopener,noreferrer');
}

export function openProductCadastro(
  productId: string,
  tab: 'fiscal' | 'identificacao' = 'fiscal',
): void {
  const q = new URLSearchParams({ edit: productId, tab });
  window.open(`/produtos?${q.toString()}`, '_blank', 'noopener,noreferrer');
}
