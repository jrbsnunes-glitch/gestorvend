import type { ReactNode } from 'react';
import { useModalEscapeKey } from '../lib/useModalEscapeKey';

export type RecordViewField = {
  label: string;
  value: ReactNode;
};

export type RecordViewColumn = string | { label: string; num?: boolean };

export type RecordViewTableSection = {
  title: string;
  empty?: string;
  columns: RecordViewColumn[];
  rows: ReactNode[][];
  tableClassName?: string;
  maxHeight?: string | number;
};

export type RecordViewFieldsSection = {
  title: string;
  fields: RecordViewField[];
};

export type RecordViewCustomSection = {
  title: string;
  content: ReactNode;
};

export type RecordViewSection =
  | RecordViewFieldsSection
  | RecordViewTableSection
  | RecordViewCustomSection;

function isFieldsSection(s: RecordViewSection): s is RecordViewFieldsSection {
  return 'fields' in s;
}

function isTableSection(s: RecordViewSection): s is RecordViewTableSection {
  return 'columns' in s && 'rows' in s;
}

function displayValue(value: ReactNode): ReactNode {
  if (value == null || value === '') return '—';
  return value;
}

function columnLabel(c: RecordViewColumn): string {
  return typeof c === 'string' ? c : c.label;
}

function columnIsNum(c: RecordViewColumn): boolean {
  return typeof c === 'object' && Boolean(c.num);
}

/** Tabela Campo | Valor — mesmo padrão da visualização de produtos. */
export function RecordViewFieldsTable({ fields }: { fields: RecordViewField[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table record-view-table record-view-table--fields">
        <thead>
          <tr>
            <th>Campo</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.label}>
              <td>{f.label}</td>
              <td>{displayValue(f.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecordViewDataTable({
  columns,
  rows,
  empty,
  tableClassName,
  maxHeight,
}: {
  columns: RecordViewColumn[];
  rows: ReactNode[][];
  empty?: string;
  tableClassName?: string;
  maxHeight?: string | number;
}) {
  if (rows.length === 0) {
    return <p className="record-view-sections__empty">{empty ?? 'Nenhum registro.'}</p>;
  }
  return (
    <div
      className="table-wrap"
      style={maxHeight != null ? { maxHeight, overflow: 'auto' } : undefined}
    >
      <table
        className={['data-table', 'record-view-table', tableClassName].filter(Boolean).join(' ')}
      >
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={columnIsNum(c) ? 'num' : undefined}>
                {columnLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td key={j} className={columnIsNum(columns[j]!) ? 'num' : undefined}>
                  {displayValue(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecordViewSections({ sections }: { sections: RecordViewSection[] }) {
  return (
    <div className="record-view-sections">
      {sections.map((section) => (
        <div key={section.title}>
          <h3 className="record-view-sections__title">{section.title}</h3>
          {isFieldsSection(section) ? (
            <RecordViewFieldsTable fields={section.fields} />
          ) : isTableSection(section) ? (
            <RecordViewDataTable
              columns={section.columns}
              rows={section.rows}
              empty={section.empty}
              tableClassName={section.tableClassName}
              maxHeight={section.maxHeight}
            />
          ) : (
            section.content
          )}
        </div>
      ))}
    </div>
  );
}

type RecordViewModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  wide?: boolean;
  loading?: boolean;
  error?: string | null;
  sections?: RecordViewSection[];
  children?: ReactNode;
};

/**
 * Modal de visualização padronizado (mesmo layout do cadastro de produtos):
 * seções com tabela Campo/Valor ou tabelas de listagem; fecha ao clicar fora / ESC.
 */
export function RecordViewModal({
  open,
  title,
  onClose,
  wide = false,
  loading = false,
  error = null,
  sections = [],
  children,
}: RecordViewModalProps) {
  useModalEscapeKey(open ? onClose : () => undefined);
  if (!open) return null;

  return (
    <div
      className={['modal-backdrop', wide ? 'modal-backdrop--wide' : '', 'no-print']
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={['modal', wide ? 'modal--wide' : ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {loading && <p>Carregando…</p>}
        {error && <div className="alert alert-error">{error}</div>}
        {!loading && !error && (
          <>
            {sections.length > 0 ? <RecordViewSections sections={sections} /> : null}
            {children}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
