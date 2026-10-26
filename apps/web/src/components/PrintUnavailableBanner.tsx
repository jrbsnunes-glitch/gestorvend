import { useEffect, useState } from 'react';

type PrintUnavailableDetail = { standalone?: boolean };

export function PrintUnavailableBanner() {
  const [open, setOpen] = useState(false);
  const [standalone, setStandalone] = useState(false);

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

  return (
    <div className="gv-print-fallback-banner no-print" role="status">
      <p>
        {standalone
          ? 'Neste atalho da tela inicial a impressão do sistema não abre. Abra o GestorVend no Safari ou Chrome e use Compartilhar → Imprimir (ou Salvar em PDF).'
          : 'A impressão não abriu neste aparelho. No navegador, toque em Compartilhar e escolha Imprimir ou Salvar em PDF.'}
      </p>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
        Fechar
      </button>
    </div>
  );
}
