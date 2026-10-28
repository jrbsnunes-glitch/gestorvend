import { useState } from 'react';
import { printCurrentPage } from '../lib/print-page';
import { saveCurrentPagePdf } from '../lib/save-page-pdf';

/** Imprimir (navegador) + Salvar PDF (PWA / celular, onde print() não abre). */
export function PrintActions() {
  const [busy, setBusy] = useState(false);

  async function onSavePdf() {
    setBusy(true);
    try {
      await saveCurrentPagePdf();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível gerar o PDF.';
      window.alert(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={printCurrentPage} disabled={busy}>
        Imprimir
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => void onSavePdf()} disabled={busy}>
        {busy ? 'Gerando PDF…' : 'Salvar PDF'}
      </button>
    </>
  );
}
