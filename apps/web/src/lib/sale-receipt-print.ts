/**
 * Impressão de cupom não fiscal no PDV.
 *
 * No **GestorVend Desktop**, com impressora configurada em Configurações → Impressão,
 * o cupom sai em silêncio na térmica 80 mm (`printUrl` / `printSilent` + deviceName).
 * No navegador puro, usa o diálogo Imprimir do sistema.
 */

import { isGestorVendDesktop } from './desktop-bridge';
import { tryDesktopPrintUrl } from './desktop-print';

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

function receiptPrintPath(saleId: string, nonce: string, opts?: { autoprint?: boolean; close?: boolean }): string {
  const q = new URLSearchParams({
    id: saleId,
    _np: nonce,
  });
  if (opts?.autoprint !== false) q.set('autoprint', '1');
  if (opts?.close !== false) q.set('close', '1');
  return `/vendas/impressao?${q.toString()}`;
}

/**
 * Carrega o cupom e dispara a impressão.
 * No Desktop: janela oculta + impressão silenciosa (sem diálogo Windows).
 * Não usa `noopener` (senão window.open retorna null e caía em iframe sem bridge).
 */
export function queueSaleReceiptAutoPrint(saleId: string): void {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const path = receiptPrintPath(saleId, nonce);

  if (isGestorVendDesktop()) {
    void (async () => {
      // Sem autoprint: o main process imprime após o HTML ficar pronto (evita diálogo + double print).
      const pathSilent = receiptPrintPath(saleId, nonce, { autoprint: false, close: false });
      const ok = await tryDesktopPrintUrl(pathSilent, '80mm');
      if (ok) return;
      // Fallback: janela filha COM preload (sem noopener) e autoprint na página.
      window.open(
        receiptPrintPath(saleId, nonce, { autoprint: true, close: true }),
        'gv_sale_receipt',
        'width=420,height=720',
      );
    })();
    return;
  }

  const w = window.open(path, 'gv_sale_receipt', 'noopener,noreferrer,width=420,height=720');
  if (w) return;

  // Fallback se pop-up bloqueado (navegador): iframe.
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

export function posAutoPrintModeLabel(mode: PosAutoPrintMode): string {
  if (mode === 'on') return 'Sempre imprimir após venda';
  if (mode === 'off') return 'Nunca imprimir automaticamente';
  return 'Seguir cadastro da empresa';
}
