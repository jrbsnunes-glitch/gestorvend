import { isGestorVendDesktop } from './desktop-bridge';
import { tryDesktopPrintUrl } from './desktop-print';

function cashClosePrintPath(
  sessionId: string,
  nonce: string,
  opts?: { autoprint?: boolean; close?: boolean },
): string {
  const q = new URLSearchParams({
    id: sessionId,
    _np: nonce,
  });
  if (opts?.autoprint !== false) q.set('autoprint', '1');
  if (opts?.close !== false) q.set('close', '1');
  return `/caixa/impressao-fechamento?${q.toString()}`;
}

/** Imprime o cupom térmico 80 mm do fechamento de caixa. */
export function queueCashCloseAutoPrint(sessionId: string): void {
  if (!sessionId.trim()) return;
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const path = cashClosePrintPath(sessionId, nonce);

  if (isGestorVendDesktop()) {
    void (async () => {
      const pathSilent = cashClosePrintPath(sessionId, nonce, { autoprint: false, close: false });
      const ok = await tryDesktopPrintUrl(pathSilent, '80mm');
      if (ok) return;
      window.open(
        cashClosePrintPath(sessionId, nonce, { autoprint: true, close: true }),
        'gv_cash_close',
        'width=420,height=720',
      );
    })();
    return;
  }

  const w = window.open(path, 'gv_cash_close', 'noopener,noreferrer,width=420,height=720');
  if (w) return;

  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:80mm;height:160mm;border:0;opacity:0.01;z-index:-1;';
  iframe.src = path;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Fechamento de caixa');
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  }, 120_000);
}
