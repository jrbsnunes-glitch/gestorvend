/** Só os dígitos da chave NF-e (máx. 44). Aceita cola com espaços/pontos. */
export function digitsNfeAccessKey(raw: string, max = 44): string {
  return String(raw ?? '').replace(/\D/g, '').slice(0, max);
}

/** Extrai 44 dígitos do clipboard. Null se não houver número. */
export function nfeAccessKeyFromClipboard(data: DataTransfer | null): string | null {
  const digits = digitsNfeAccessKey(data?.getData('text') ?? '');
  return digits || null;
}
