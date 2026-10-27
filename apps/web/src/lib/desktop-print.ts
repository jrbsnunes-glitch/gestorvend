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
    const msg = 'Defina a impressora do PDV em Configurações → Impressão.';
    console.warn('[desktop-print]', msg);
    try {
      window.dispatchEvent(new CustomEvent('gv-print-failed', { detail: { error: msg } }));
    } catch {
      /* ignore */
    }
    return false;
  }

  const res = await api.printSilent({ deviceName, pageSize, printBackground: true });
  if (!res.ok) {
    const msg = res.error || 'Falha na impressão silenciosa';
    console.warn('[desktop-print]', msg);
    try {
      window.dispatchEvent(new CustomEvent('gv-print-failed', { detail: { error: msg } }));
    } catch {
      /* ignore */
    }
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

export type SaveDocumentPdfResult = {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
};

const RECEIPT_PDF_PAGE_STYLE_ID = 'gv-receipt-pdf-page';

function injectA4ReceiptPdfStyles(): HTMLStyleElement {
  document.getElementById(RECEIPT_PDF_PAGE_STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = RECEIPT_PDF_PAGE_STYLE_ID;
  style.textContent = `
    @page { size: A4 portrait; margin: 12mm; }
    @media print {
      html.gv-receipt-save-pdf .sale-receipt-doc {
        width: 80mm !important;
        max-width: 80mm !important;
        margin: 0 auto !important;
      }
    }
  `;
  document.head.appendChild(style);
  document.documentElement.classList.add('gv-receipt-save-pdf');
  return style;
}

function removeA4ReceiptPdfStyles(style: HTMLStyleElement): void {
  document.documentElement.classList.remove('gv-receipt-save-pdf');
  style.remove();
}

/**
 * Gera um PDF A4 do cupom (não usa a térmica ESC/POS nem “Microsoft Print to PDF”
 * em papel 80 mm — esse caminho gerava arquivo de 0 bytes).
 *
 * No Desktop: printToPDF + diálogo Salvar.
 * No navegador: injeta @page A4 e abre o diálogo Imprimir (escolha “Salvar como PDF”).
 */
export async function saveDocumentPdf(opts?: {
  url?: string;
  defaultPath?: string;
}): Promise<SaveDocumentPdfResult> {
  if (isGestorVendDesktop()) {
    const api = getDesktopApi();
    if (api?.printToPdf) {
      const payload: { url?: string; defaultPath?: string } = {};
      if (opts?.defaultPath) payload.defaultPath = opts.defaultPath;
      if (opts?.url) payload.url = /^https?:\/\//i.test(opts.url) ? opts.url : absoluteAppUrl(opts.url);
      const res = await api.printToPdf(payload);
      if (!res.ok) {
        const msg = res.error || 'Falha ao gerar PDF.';
        console.warn('[desktop-print]', msg);
        try {
          window.dispatchEvent(new CustomEvent('gv-print-failed', { detail: { error: msg } }));
        } catch {
          /* ignore */
        }
      }
      return res;
    }
    if (opts?.url) {
      return {
        ok: false,
        error:
          'Este Desktop ainda não gera PDF. Instale o Setup 1.0.65 ou superior para o botão Salvar PDF.',
      };
    }
  }

  const style = injectA4ReceiptPdfStyles();
  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    removeA4ReceiptPdfStyles(style);
  };
  window.addEventListener('afterprint', cleanup);
  window.setTimeout(cleanup, 120_000);
  window.print();
  return { ok: true };
}
