export function digitsOnly(value: string | undefined | null, max?: number): string {
  const d = String(value ?? '').replace(/\D/g, '');
  return max != null ? d.slice(0, max) : d;
}

/** Máscara brasileira: 00.000.000/0000-00 (aceita digitos parciais enquanto digita). */
export function formatCnpj(value: string | undefined | null): string {
  const d = digitsOnly(value, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Máscara CPF: 000.000.000-00 */
export function formatCpf(value: string | undefined | null): string {
  const d = digitsOnly(value, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** CPF (11) ou CNPJ (14) com máscara conforme o tamanho digitado. */
export function formatCpfCnpj(value: string | undefined | null): string {
  const d = digitsOnly(value, 14);
  if (d.length <= 11) return formatCpf(d);
  return formatCnpj(d);
}

/** CEP: 00000-000 */
export function formatCep(value: string | undefined | null): string {
  const d = digitsOnly(value, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function formatBRL(value: number | string | undefined | null): string {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value ?? 0);
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

export function formatDate(iso: string | Date | undefined | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
}

export function formatStockQty(value: string | number | undefined | null): string {
  const n = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : Number(value ?? 0);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}
