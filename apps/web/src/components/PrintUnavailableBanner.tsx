import { useEffect, useState } from 'react';
import { saveCurrentPagePdf } from '../lib/save-page-pdf';

type PrintUnavailableDetail = { standalone?: boolean };

export function PrintUnavailableBanner() {
  const [open, setOpen] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onUnavailable(ev: Event) {
      const detail = (ev as CustomEvent<PrintUnavailableDetail>).detail;
      setStandalone(Boolean(detail?.standalone));
      setOpen(true);
    }
    window.addEventListener('gv-print-unavailable', onUnavailable);
    return () => window.removeEventListener('gv-print-unavailable', onUnavailable);
  }, []);

  if (!open) return null;

  async function onSavePdf() {
    setBusy(true);
    try {
      await saveCurrentPagePdf();
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível gerar o PDF.';
      window.alert(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gv-print-fallback-banner no-print" role="status">
      <p>
        {standalone
          ? 'Neste atalho da tela inicial o diálogo de impressão do sistema não abre. Use Salvar PDF — o arquivo pode ser compartilhado ou enviado para a impressora.'
          : 'A impressão não abriu neste aparelho. Use Salvar PDF ou, no navegador, Compartilhar → Imprimir.'}
      </p>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSavePdf()}>
        {busy ? 'Gerando PDF…' : 'Salvar PDF'}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
        Fechar
      </button>
    </div>
  );
}
