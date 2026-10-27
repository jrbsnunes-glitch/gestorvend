import { isGestorVendDesktop } from './desktop-bridge';
import { tryDesktopPrintUrl } from './desktop-print';

function cashMovementPrintPath(
  movementId: string,
  nonce: string,
  opts?: { autoprint?: boolean; close?: boolean },
): string {
  const q = new URLSearchParams({
    id: movementId,
    _np: nonce,
  });
  if (opts?.autoprint !== false) q.set('autoprint', '1');
  if (opts?.close !== false) q.set('close', '1');
  return `/caixa/impressao-movimento?${q.toString()}`;
}

/** Imprime o cupom térmico 80 mm de sangria, suprimento ou despesa. */
export function queueCashMovementAutoPrint(movementId: string): void {
  if (!movementId.trim()) return;
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const path = cashMovementPrintPath(movementId, nonce);

  if (isGestorVendDesktop()) {
    void (async () => {
      const pathSilent = cashMovementPrintPath(movementId, nonce, { autoprint: false, close: false });
      const ok = await tryDesktopPrintUrl(pathSilent, '80mm');
      if (ok) return;
      window.open(
        cashMovementPrintPath(movementId, nonce, { autoprint: true, close: true }),
        'gv_cash_movement',
        'width=420,height=640',
      );
    })();
    return;
  }

  const w = window.open(path, 'gv_cash_movement', 'noopener,noreferrer,width=420,height=640');
  if (w) return;

  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:80mm;height:140mm;border:0;opacity:0.01;z-index:-1;';
  iframe.src = path;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Comprovante de caixa');
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  }, 120_000);
}
