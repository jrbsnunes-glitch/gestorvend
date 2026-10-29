import { isGestorVendDesktop } from './desktop-bridge';
import { tryDesktopPrintUrl } from './desktop-print';

export function reservationReceiptPath(
  id: string,
  opts?: { copy?: boolean; autoprint?: boolean },
): string {
  const q = new URLSearchParams({ id });
  if (opts?.copy) q.set('copy', '1');
  if (opts?.autoprint) q.set('autoprint', '1');
  return `/reservas-venda/impressao?${q.toString()}`;
}

export function openReservationReceipt(id: string, opts?: { copy?: boolean }): void {
  const path = reservationReceiptPath(id, { copy: opts?.copy, autoprint: true });
  if (isGestorVendDesktop()) {
    void (async () => {
      const silent = reservationReceiptPath(id, { copy: opts?.copy });
      const ok = await tryDesktopPrintUrl(silent, '80mm');
      if (ok) return;
      window.open(path, 'gv_reservation_receipt', 'width=820,height=920');
    })();
    return;
  }
  const w = window.open(path, 'gv_reservation_receipt', 'noopener,noreferrer,width=820,height=920');
  if (!w) {
    window.alert('Permita pop-ups para imprimir o comprovante da reserva.');
  }
}
