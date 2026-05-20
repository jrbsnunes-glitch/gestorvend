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
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className={`modal${wide ? ' modal--wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h2 className="no-print">Relatórios — {title}</h2>
        {!compactLauncher && (
          <p className="page-desc no-print" style={{ marginBottom: '1rem' }}>
            Relatórios específicos deste módulo. Os itens abaixo serão preenchidos conforme evolução do sistema.
          </p>
        )}
        {compactLauncher && (
          <p className="page-desc no-print" style={{ marginBottom: '0.75rem', fontSize: '0.86rem' }}>
            Informe filtros aqui. O resultado abre numa página limpa para leitura e impressão.
          </p>
        )}
        <div className="card" style={{ padding: compactLauncher ? '0.85rem 1rem' : '1rem' }}>
          {!compactLauncher ? (
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
          ) : (
            children
          )}
        </div>
        <div className="modal-actions no-print">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
