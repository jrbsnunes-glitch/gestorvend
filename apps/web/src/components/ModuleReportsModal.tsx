import type { ReactNode } from 'react';
import { StandardReportHeader } from './StandardReportHeader';

export function ModuleReportsModal({
  open,
  title,
  onClose,
  children,
  wide,
  /** Sem cabeçalho empresa + carimbo (ex.: relatórios que abrem em página dedicada). */
  compactLauncher,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Modal mais largo (tabelas de relatório). */
  wide?: boolean;
  compactLauncher?: boolean;
}) {
  if (!open) return null;
  const modalClass = [
    'modal',
    wide ? 'modal--wide' : '',
    compactLauncher ? 'modal--filters-compact module-reports-modal--launcher' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className={modalClass} onClick={(e) => e.stopPropagation()}>
        <h2 className="no-print">Relatórios — {title}</h2>
        {!compactLauncher && (
          <p className="page-desc no-print" style={{ marginBottom: '1rem' }}>
            Relatórios específicos deste módulo. Os itens abaixo serão preenchidos conforme evolução do sistema.
          </p>
        )}
        {compactLauncher && (
          <p className="filter-modal-hint no-print">
            Filtros abaixo; o resultado abre em página para impressão.
          </p>
        )}
        {compactLauncher ? (
          children
        ) : (
          <div className="card" style={{ padding: '1rem' }}>
            <div className="gv-report-sheet">
              <StandardReportHeader
                documentTitle={`Relatórios — ${title}`}
                documentExtras={
                  <p className="print-sub page-desc" style={{ marginBottom: 0 }}>
                    Conteúdo conforme filtros e períodos informados nesta tela. Use o cabeçalho para fins de arquivo
                    físico ou trilhas de auditoria.
                  </p>
                }
              />
              {children}
            </div>
          </div>
        )}
        <div className="modal-actions no-print">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
