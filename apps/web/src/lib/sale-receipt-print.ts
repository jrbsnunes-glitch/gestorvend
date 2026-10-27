/**
 * Impressão de cupom não fiscal no PDV.
 *
 * No **GestorVend Desktop**, com impressora configurada em Configurações → Impressão,
 * o cupom sai em silêncio na térmica 80 mm (`printUrl` / `printSilent` + deviceName).
 * No navegador puro, usa o diálogo Imprimir do sistema.
 */

import { isGestorVendDesktop } from './desktop-bridge';
import { absoluteAppUrl, saveDocumentPdf, tryDesktopPrintUrl } from './desktop-print';

const POS_AUTO_PRINT_KEY = 'gv_pos_auto_print_receipt';

export type PosAutoPrintMode = 'inherit' | 'on' | 'off';

export function getPosAutoPrintMode(): PosAutoPrintMode {
  try {
    const v = localStorage.getItem(POS_AUTO_PRINT_KEY);
    if (v === 'on' || v === 'off' || v === 'inherit') return v;
  } catch {
    /* private mode etc. */
  }
  return 'inherit';
}

export function setPosAutoPrintMode(mode: PosAutoPrintMode): void {
  try {
    localStorage.setItem(POS_AUTO_PRINT_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Respeita cadastro da empresa quando mode === inherit. */
export function effectiveAutoPrintAfterSale(companyDefault: boolean): boolean {
  const mode = getPosAutoPrintMode();
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return companyDefault;
}

const autoprintNonceDone = new Set<string>();

/**
 * Evita chamada dupla de `print()` (ex.: React Strict Mode em desenvolvimento).
 */
export function consumeAutoPrintNonce(nonce: string | null, saleId: string): boolean {
  const key = nonce?.trim() ? `np:${nonce}` : `sid:${saleId}`;
  if (autoprintNonceDone.has(key)) return false;
  autoprintNonceDone.add(key);
  if (autoprintNonceDone.size > 80) {
    autoprintNonceDone.clear();
  }
  return true;
}

function receiptPrintPath(
  saleId: string,
  nonce: string,
  opts?: { autoprint?: boolean; close?: boolean; copy?: boolean; savepdf?: boolean },
): string {
  const q = new URLSearchParams({
    id: saleId,
    _np: nonce,
  });
  if (opts?.autoprint !== false) q.set('autoprint', '1');
  if (opts?.close !== false) q.set('close', '1');
  if (opts?.copy) q.set('copy', '1');
  if (opts?.savepdf) q.set('savepdf', '1');
  return `/vendas/impressao?${q.toString()}`;
}

export function receiptPdfFileName(opts?: {
  number?: number | string | null;
  copy?: boolean;
}): string {
  const raw = opts?.number != null ? String(opts.number).trim() : '';
  const n = (raw.replace(/[^\w.-]+/g, '') || 'cupom').slice(0, 24);
  const via = opts?.copy ? '-2via' : '';
  return `cupom-${n}${via}.pdf`;
}

/**
 * Carrega o cupom e dispara a impressão.
 * No Desktop: janela oculta + impressão silenciosa (sem diálogo Windows).
 * Não usa `noopener` (senão window.open retorna null e caía em iframe sem bridge).
 */
export function queueSaleReceiptAutoPrint(saleId: string, opts?: { copy?: boolean }): void {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const copy = Boolean(opts?.copy);
  const path = receiptPrintPath(saleId, nonce, { copy });

  if (isGestorVendDesktop()) {
    void (async () => {
      const pathSilent = receiptPrintPath(saleId, nonce, { autoprint: false, close: false, copy });
      const ok = await tryDesktopPrintUrl(pathSilent, '80mm');
      if (ok) return;

      // Fallback: janela filha COM preload e autoprint na página.
      const w = window.open(
        receiptPrintPath(saleId, nonce, { autoprint: true, close: true, copy }),
        'gv_sale_receipt',
        'width=420,height=720',
      );
      if (!w) {
        window.alert(
          'Não foi possível enviar o cupom à impressora.\n\nConfira: impressora do PDV em Configurações → Impressão, Desktop atualizado (npm run pack) e servidor atualizado.',
        );
      }
    })();
    return;
  }

  const w = window.open(path, 'gv_sale_receipt', 'noopener,noreferrer,width=420,height=720');
  if (w) return;

  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:80mm;height:120mm;border:0;opacity:0.01;z-index:-1;';
  iframe.src = path;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Cupom de venda');
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  }, 120_000);
}

/**
 * Gera PDF A4 do cupom (segunda via ou 1ª). No Desktop usa printToPDF, sem
 * passar pela térmica ESC/POS — o destino “Microsoft Print to PDF” em 80 mm
 * gerava arquivo de 0 bytes.
 */
export function queueSaleReceiptPdf(
  saleId: string,
  opts?: { copy?: boolean; number?: number | string | null },
): void {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const copy = Boolean(opts?.copy);
  const desktop = isGestorVendDesktop();
  const path = receiptPrintPath(saleId, nonce, {
    autoprint: false,
    close: false,
    copy,
    savepdf: !desktop,
  });
  const defaultPath = receiptPdfFileName({ number: opts?.number, copy });

  void (async () => {
    if (desktop) {
      const res = await saveDocumentPdf({ url: absoluteAppUrl(path), defaultPath });
      if (res.ok) return;
      window.alert(
        res.error?.trim() ||
          'Não foi possível gerar o PDF.\n\nAtualize o GestorVend Desktop (novo Setup) para o recurso Salvar PDF.',
      );
      return;
    }

    const w = window.open(path, 'gv_sale_receipt_pdf', 'noopener,noreferrer,width=520,height=800');
    if (w) return;
    window.alert('Permita pop-ups para abrir o cupom e salvar o PDF.');
  })();
}

export function posAutoPrintModeLabel(mode: PosAutoPrintMode): string {
  if (mode === 'on') return 'Sempre imprimir após venda';
  if (mode === 'off') return 'Nunca imprimir automaticamente';
  return 'Seguir cadastro da empresa';
}
