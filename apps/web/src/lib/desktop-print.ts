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
    /* sem config — ainda tenta silent com padrão do SO */
  }

  // Sem impressora definida no Desktop, deixa o diálogo do navegador (mais previsível).
  if (!deviceName) return false;

  const res = await api.printSilent({ deviceName, pageSize, printBackground: true });
  if (!res.ok) {
    console.warn('[desktop-print]', res.error || 'Falha na impressão silenciosa');
    return false;
  }
  return true;
}

/** Imprime cupom/DANFE: Desktop silencioso se configurado; senão diálogo do SO. */
export async function printDocument(pageSize: DesktopPrintPageSize = '80mm'): Promise<void> {
  const used = await tryDesktopSilentPrint(pageSize);
  if (!used) window.print();
}
