/**
 * Impressão silenciosa via GestorVend Desktop (impressora padrão do PDV + bobina 80 mm).
 * No navegador puro cai em window.print().
 */
import { getDesktopApi, isGestorVendDesktop } from './desktop-bridge';

export type DesktopPrintPageSize = '80mm' | 'A4';

/**
 * Tenta imprimir a página atual pela impressora configurada no Desktop.
 * @returns true se usou o bridge Desktop; false se deve usar window.print().
 */
export async function tryDesktopSilentPrint(
  pageSize: DesktopPrintPageSize = '80mm',
): Promise<boolean> {
  if (!isGestorVendDesktop()) return false;
  const api = getDesktopApi();
  if (!api?.printSilent) return false;

  let deviceName: string | undefined;
  try {
    const cfg = await api.getPdvPrinter?.();
    deviceName = cfg?.printer?.trim() || undefined;
  } catch {
    /* ignore */
  }

  if (!deviceName) {
    console.warn('[desktop-print] Impressora do PDV não configurada.');
    return false;
  }

  const res = await api.printSilent({ deviceName, pageSize, printBackground: true });
  if (!res.ok) {
    console.warn('[desktop-print]', res.error || 'Falha na impressão silenciosa');
    return false;
  }
  return true;
}

/**
 * Imprime cupom/DANFE.
 * No Desktop com impressora do PDV: silencioso (sem diálogo).
 * Se o silent falhar no Desktop, NÃO abre o diálogo do Windows (evita surpresa no PDV).
 */
export async function printDocument(pageSize: DesktopPrintPageSize = '80mm'): Promise<void> {
  const desktop = isGestorVendDesktop();
  const used = await tryDesktopSilentPrint(pageSize);
  if (used) return;
  if (desktop) {
    // Já tentou silent; diálogo do SO é exatamente o que o PDV não quer.
    console.warn(
      '[desktop-print] Impressão silenciosa indisponível. Confira a impressora do PDV e se o Desktop está atualizado.',
    );
    return;
  }
  window.print();
}

/** Caminho relativo → URL absoluta na origem atual. */
export function absoluteAppUrl(pathAndQuery: string): string {
  if (/^https?:\/\//i.test(pathAndQuery)) return pathAndQuery;
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  return `${window.location.origin}${path}`;
}

/**
 * Imprime uma URL (cupom) numa janela oculta do Desktop, sem diálogo.
 * @returns true se o Desktop aceitou o job.
 */
export async function tryDesktopPrintUrl(
  pathAndQuery: string,
  pageSize: DesktopPrintPageSize = '80mm',
): Promise<boolean> {
  if (!isGestorVendDesktop()) return false;
  const api = getDesktopApi();
  if (!api?.printUrl) return false;

  let deviceName: string | undefined;
  try {
    const cfg = await api.getPdvPrinter?.();
    deviceName = cfg?.printer?.trim() || undefined;
  } catch {
    /* ignore */
  }

  const res = await api.printUrl({
    url: absoluteAppUrl(pathAndQuery),
    deviceName,
    pageSize,
  });
  if (!res.ok) {
    const msg = res.error || 'Falha printUrl';
    console.warn('[desktop-print]', msg);
    try {
      window.dispatchEvent(
        new CustomEvent('gv-print-failed', { detail: { error: msg, path: pathAndQuery } }),
      );
    } catch {
      /* ignore */
    }
    return false;
  }
  return true;
}
