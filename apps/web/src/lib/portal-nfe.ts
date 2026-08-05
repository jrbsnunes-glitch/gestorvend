/**
 * Consulta resumida no Portal Nacional da NF-e.
 * A SEFAZ não documenta (nem honra de forma estável) querystring com a chave —
 * o campo só aceita digitação/cola + reCAPTCHA. Por isso copiamos a chave
 * para a área de transferência ao abrir.
 */
export const PORTAL_NFE_CONSULTA_URL =
  'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=';

/**
 * Erros em que abrir o Portal não resolve — a pendência é local, não da SEFAZ.
 * Fora desta lista, qualquer falha da busca por chave impede a entrada e o
 * caminho manual (Portal → baixar XML → Importar XML) é o fallback válido.
 */
const LOCAL_ONLY_ERROR_PATTERNS: RegExp[] = [
  /j[áa]\s+(foi\s+)?(importad|lan[çc]ad|utilizad)/i,
  /chave[^.]*(inv[áa]lid|44\s*d[íi]gitos|d[íi]gito\s+verificador)/i,
  /informe\s+a\s+chave/i,
];

/** A busca por chave falhou de um jeito que exige baixar o XML no Portal? */
export function shouldOfferPortalXmlFallback(message: string): boolean {
  const m = (message ?? '').trim();
  if (!m) return false;
  return !LOCAL_ONLY_ERROR_PATTERNS.some((re) => re.test(m));
}

/** Abre o Portal em nova aba. Síncrono de propósito: preserva o gesto do usuário. */
function openPortalNfeConsultaTab(): boolean {
  const w = window.open(PORTAL_NFE_CONSULTA_URL, '_blank', 'noopener,noreferrer');
  return Boolean(w);
}

/**
 * Abre o Portal Nacional em nova aba e copia a chave (44 dígitos) para colar no campo.
 * Não dá para pré-preencher via URL — limitação do site da SEFAZ.
 * A aba é aberta antes da cópia porque `await` quebra a cadeia de gesto do
 * usuário e o navegador passa a bloquear o pop-up.
 */
export async function openPortalNfeConsulta(
  accessKey?: string,
): Promise<{ copied: boolean; opened: boolean }> {
  const opened = openPortalNfeConsultaTab();
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
  return { copied, opened };
}
