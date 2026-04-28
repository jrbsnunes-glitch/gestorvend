import type { ReactNode } from 'react';
import './crud-toolbar.css';

export type CrudToolbarProps = {
  /** Botões à esquerda de “Incluir” (ex.: Pesquisar). */
  leadingPrimary?: ReactNode;
  /** Se omitido, o botão Incluir não é exibido (ex.: telas só de consulta). */
  onInclude?: () => void;
  onPrint: () => void;
  onReports: () => void;
  includeLabel?: string;
};

export function CrudToolbar({
  leadingPrimary,
  onInclude,
  onPrint,
  onReports,
  includeLabel = 'Incluir',
}: CrudToolbarProps) {
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
        <button type="button" className="btn btn-secondary" onClick={onPrint}>
          Imprimir
        </button>
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
