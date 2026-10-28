import { useState, type ReactNode } from 'react';
import { printCurrentPage } from '../lib/print-page';
import { saveCurrentPagePdf } from '../lib/save-page-pdf';
import './crud-toolbar.css';

export type CrudToolbarProps = {
  /** Botões à esquerda de “Incluir” (ex.: Pesquisar). */
  leadingPrimary?: ReactNode;
  /** Se omitido, o botão Incluir não é exibido (ex.: telas só de consulta). */
  onInclude?: () => void;
  /** Se informado, exibe Imprimir (o clique usa impressão segura no celular). */
  onPrint?: () => void;
  onReports: () => void;
  includeLabel?: string;
  /** Botões extras no grupo da direita (ex.: Exportar XML). */
  trailingExtra?: ReactNode;
};

export function CrudToolbar({
  leadingPrimary,
  onInclude,
  onPrint,
  onReports,
  includeLabel = 'Incluir',
  trailingExtra,
}: CrudToolbarProps) {
  const [pdfBusy, setPdfBusy] = useState(false);

  async function onSavePdf() {
    setPdfBusy(true);
    try {
      await saveCurrentPagePdf();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível gerar o PDF.';
      window.alert(msg);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="crud-toolbar no-print">
      <div className="crud-toolbar-group crud-toolbar-primary-slot">
        {leadingPrimary}
        {onInclude != null ? (
          <button type="button" className="btn btn-primary crud-btn-include" onClick={onInclude}>
            {includeLabel}
          </button>
        ) : (
          <span className="crud-toolbar-placeholder" aria-hidden />
        )}
      </div>
      <div className="crud-toolbar-group">
        {onPrint != null ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={printCurrentPage}>
              Imprimir
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pdfBusy}
              onClick={() => void onSavePdf()}
            >
              {pdfBusy ? 'Gerando PDF…' : 'Salvar PDF'}
            </button>
          </>
        ) : null}
        {trailingExtra}
        <button type="button" className="btn btn-secondary" onClick={onReports}>
          Relatórios
        </button>
      </div>
    </div>
  );
}

export type RowRecordActionsProps = {
  onEdit: () => void;
  onView: () => void;
  onDelete: () => void;
  /** Se false, o botão Excluir fica desabilitado (ex.: movimentações de estoque). */
  canDelete?: boolean;
};

/** Alterar, Visualizar e Excluir por linha — usar dentro de `<td>` na tabela. */
export function RowRecordActions({ onEdit, onView, onDelete, canDelete = true }: RowRecordActionsProps) {
  return (
    <div className="row-record-actions no-print">
      <button type="button" className="btn btn-secondary btn-compact" onClick={onEdit}>
        Alterar
      </button>
      <button type="button" className="btn btn-secondary btn-compact" onClick={onView}>
        Visualizar
      </button>
      <button type="button" className="btn btn-danger btn-compact" disabled={!canDelete} onClick={onDelete}>
        Excluir
      </button>
    </div>
  );
}
