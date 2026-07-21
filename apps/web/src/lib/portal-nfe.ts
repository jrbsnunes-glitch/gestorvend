/**
 * Consulta resumida no Portal Nacional da NF-e.
 * A SEFAZ não documenta (nem honra de forma estável) querystring com a chave —
 * o campo só aceita digitação/cola + reCAPTCHA. Por isso copiamos a chave
 * para a área de transferência ao abrir.
 */
export const PORTAL_NFE_CONSULTA_URL =
  'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=';

/** cStats em que o WS não entrega o XML e o fallback é Portal → Importar XML. */
export function isPortalXmlFallbackCStat(message: string): boolean {
  return /\bcStat\s*640\b/i.test(message) || /\bcStat\s*137\b/i.test(message) || /\bcStat\s*632\b/i.test(message);
}

/**
 * Abre o Portal Nacional em nova aba e copia a chave (44 dígitos) para colar no campo.
 * Não dá para pré-preencher via URL — limitação do site da SEFAZ.
 */
export async function openPortalNfeConsulta(accessKey?: string): Promise<{ copied: boolean }> {
  const key = (accessKey ?? '').replace(/\D/g, '');
  let copied = false;
  if (key.length === 44 && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(key);
      copied = true;
    } catch {
      copied = false;
    }
  }
  window.open(PORTAL_NFE_CONSULTA_URL, '_blank', 'noopener,noreferrer');
  return { copied };
}
