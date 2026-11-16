import { isGestorVendDesktop } from './desktop-bridge';
import { absoluteAppUrl, saveDocumentPdf, tryDesktopPrintUrl } from './desktop-print';

export function reservationReceiptPath(
  id: string,
  opts?: { copy?: boolean; autoprint?: boolean; draft?: boolean; savepdf?: boolean },
): string {
  const q = new URLSearchParams({ id });
  if (opts?.copy) q.set('copy', '1');
  if (opts?.autoprint) q.set('autoprint', '1');
  if (opts?.draft) q.set('origem', 'rascunho');
  if (opts?.savepdf) q.set('savepdf', '1');
  return `/reservas-venda/impressao?${q.toString()}`;
}

/** PDF A4 do espelho do rascunho. No Desktop abre Salvar; no navegador, a página de impressão. */
export function openPdvDraftPdf(id: string, number?: number | string | null): void {
  const desktop = isGestorVendDesktop();
  const path = reservationReceiptPath(id, { draft: true, savepdf: !desktop });
  const defaultPath = `rascunho-${number ?? id}.pdf`;
  void (async () => {
    if (desktop) {
      const res = await saveDocumentPdf({ url: absoluteAppUrl(path), defaultPath });
      if (res.ok) return;
      window.alert(
        res.error?.trim() ||
          'Não foi possível gerar o PDF.\n\nAtualize o GestorVend Desktop para o recurso Salvar PDF.',
      );
      return;
    }
    const w = window.open(path, 'gv_pdv_draft_pdf', 'noopener,noreferrer,width=820,height=920');
    if (!w) {
      window.alert('Permita pop-ups para salvar o PDF do rascunho.');
    }
  })();
}

/** Espelho não fiscal do rascunho de venda (estoque permanece reservado). */
export function openPdvDraftMirror(id: string): void {
  const path = reservationReceiptPath(id, { draft: true, autoprint: true });
  if (isGestorVendDesktop()) {
    void (async () => {
      const silent = reservationReceiptPath(id, { draft: true });
      const ok = await tryDesktopPrintUrl(silent, '80mm');
      if (ok) return;
      window.open(path, 'gv_pdv_draft_mirror', 'width=820,height=920');
    })();
    return;
  }
  const w = window.open(path, 'gv_pdv_draft_mirror', 'noopener,noreferrer,width=820,height=920');
  if (!w) {
    window.alert('Permita pop-ups para imprimir o espelho do rascunho.');
  }
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
