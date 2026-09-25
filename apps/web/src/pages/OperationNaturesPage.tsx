import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CrudSearchFilterLeading } from '../components/CrudSearchFilterLeading';
import { CrudToolbar, RowRecordActions } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ListPagination } from '../components/ListPagination';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { RecordViewModal } from '../components/RecordViewModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { useListPagination } from '../hooks/useListPagination';
import { matchesListSearch } from '../lib/list-search';

type Nature = {
  id: string;
  code: string;
  description: string;
  cfop: string;
  notes: string | null;
  isActive: boolean;
};

const empty = () => ({ code: '', description: '', cfop: '', notes: '', isActive: true });

export function OperationNaturesPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<Nature | null>(null);
  const [viewRow, setViewRow] = useState<Nature | null>(null);
  const [deleteRow, setDeleteRow] = useState<Nature | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [draft, setDraft] = useState(empty());
  const [err, setErr] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [draftStatusFilter, setDraftStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [appliedStatusFilter, setAppliedStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');

  const list = useQuery({
    queryKey: ['operation-natures'],
    queryFn: () => api<Nature[]>('/operation-natures'),
  });

  const filteredList = useMemo(() => {
    let items = list.data ?? [];
    const q = appliedSearch.trim();
    if (q) {
      items = items.filter((n) =>
        matchesListSearch([n.code, n.description, n.cfop, n.notes], q),
      );
    }
    if (appliedStatusFilter === 'active') items = items.filter((n) => n.isActive);
    if (appliedStatusFilter === 'inactive') items = items.filter((n) => !n.isActive);
    return items;
  }, [list.data, appliedSearch, appliedStatusFilter]);

  const filtersActive = appliedStatusFilter !== 'active';

  const pagination = useListPagination(filteredList);

  function load(n: Nature) {
    setDraft({
      code: n.code,
      description: n.description,
      cfop: n.cfop,
      notes: n.notes ?? '',
      isActive: n.isActive,
    });
    setErr(null);
  }

  const create = useMutation({
    mutationFn: () =>
      api<Nature>('/operation-natures', {
        method: 'POST',
        json: {
          code: draft.code,
          description: draft.description,
          cfop: draft.cfop,
          notes: draft.notes || null,
          isActive: draft.isActive,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operation-natures'] });
      setCreateOpen(false);
      setDraft(empty());
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: (id: string) =>
      api<Nature>(`/operation-natures/${id}`, {
        method: 'PATCH',
        json: {
          code: draft.code,
          description: draft.description,
          cfop: draft.cfop,
          notes: draft.notes || null,
          isActive: draft.isActive,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operation-natures'] });
      setEditRow(null);
      setDraft(empty());
    },
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/operation-natures/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operation-natures'] });
      setDeleteRow(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const formFields = (
    <>
      <div className="form-row">
        <div className="field">
          <label htmlFor="nat-code">Código *</label>
          <input
            id="nat-code"
            value={draft.code}
            onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
            placeholder="VENDA"
          />
        </div>
        <div className="field">
          <label htmlFor="nat-cfop">CFOP *</label>
          <input
            id="nat-cfop"
            value={draft.cfop}
            onChange={(e) =>
              setDraft((d) => ({ ...d, cfop: e.target.value.replace(/\D/g, '').slice(0, 4) }))
            }
            placeholder="5102"
            inputMode="numeric"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="nat-desc">Descrição (natOp, máx. 60) *</label>
        <input
          id="nat-desc"
          value={draft.description}
          maxLength={60}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="Venda de mercadoria"
        />
      </div>
      <div className="field">
        <label htmlFor="nat-notes">Observações</label>
        <textarea
          id="nat-notes"
          rows={3}
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
        />
      </div>
      <label className="inline-checks">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
        />
        Ativa
      </label>
    </>
  );

  return (
    <div className="page print-area">
      <h1 className="page-title" style={{ fontSize: '1.15rem' }}>
        Natureza da Operação
      </h1>
      <p className="page-desc">
        Cadastro SEFAZ: CFOP e descrição (natOp) usados na emissão de NF-e modelo 55.
      </p>

      <ReportPrintSticker documentTitle="Naturezas da operação" />

      <CrudToolbar
        leadingPrimary={
          <CrudSearchFilterLeading
            onSearch={() => {
              setDraftSearch(appliedSearch);
              setSearchOpen(true);
            }}
            onFilters={() => {
              setDraftStatusFilter(appliedStatusFilter);
              setFiltersOpen(true);
            }}
            filtersActive={filtersActive}
          />
        }
        onInclude={() => {
          setDraft(empty());
          setErr(null);
          setCreateOpen(true);
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
      />

      {searchOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setSearchOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2>Pesquisar naturezas</h2>
            <div className="field">
              <label htmlFor="nat-search-q">Termo</label>
              <input
                id="nat-search-q"
                type="search"
                autoFocus
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                placeholder="Código, CFOP ou descrição…"
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setDraftSearch('');
                  setAppliedSearch('');
                  setSearchOpen(false);
                }}
              >
                Limpar
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setSearchOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setAppliedSearch(draftSearch.trim());
                  setSearchOpen(false);
                }}
              >
                Aplicar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {filtersOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setFiltersOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2>Filtros da listagem</h2>
            <div className="field">
              <label htmlFor="nat-filter-status">Status</label>
              <select
                id="nat-filter-status"
                value={draftStatusFilter}
                onChange={(e) =>
                  setDraftStatusFilter(e.target.value as 'active' | 'inactive' | 'all')
                }
              >
                <option value="active">Somente ativas</option>
                <option value="inactive">Somente inativas</option>
                <option value="all">Todas</option>
              </select>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setDraftStatusFilter('active');
                  setAppliedStatusFilter('active');
                  setFiltersOpen(false);
                }}
              >
                Limpar
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setFiltersOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setAppliedStatusFilter(draftStatusFilter);
                  setFiltersOpen(false);
                }}
              >
                Aplicar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <ModuleReportsModal
        open={reportsOpen}
        title="Natureza da Operação"
        onClose={() => setReportsOpen(false)}
      >
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Lista de naturezas ativas por CFOP</li>
        </ul>
      </ModuleReportsModal>

      {list.isError && <div className="alert alert-error">{(list.error as Error).message}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>CFOP</th>
              <th>Descrição</th>
              <th>Status</th>
              <th className="col-actions">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={5} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!list.isLoading && !filteredList.length && (
              <tr>
                <td colSpan={5} className="empty">
                  {list.data?.length
                    ? 'Nenhuma natureza com os filtros atuais.'
                    : 'Nenhuma natureza cadastrada.'}
                </td>
              </tr>
            )}
            {pagination.pageItems.map((n) => (
              <tr key={n.id}>
                <td>
                  <strong>{n.code}</strong>
                </td>
                <td>{n.cfop}</td>
                <td>{n.description}</td>
                <td>{n.isActive ? 'Ativa' : 'Inativa'}</td>
                <td className="col-actions">
                  <RowRecordActions
                    onEdit={() => {
                      load(n);
                      setEditRow(n);
                    }}
                    onView={() => setViewRow(n)}
                    onDelete={() => {
                      setErr(null);
                      setDeleteRow(n);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        pageSize={pagination.pageSize}
        onPageChange={pagination.setPage}
      />

      {createOpen && (
        <FormModalBackdrop className="modal-backdrop--cadastro" onClose={() => setCreateOpen(false)}>
          <div
            className="modal form-cadastro-modal form-cadastro-modal--md"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Nova natureza</h2>
            {err && <div className="alert alert-error">{err}</div>}
            {formFields}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!draft.code.trim() || !draft.description.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                Salvar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {editRow && (
        <FormModalBackdrop className="modal-backdrop--cadastro" onClose={() => setEditRow(null)}>
          <div
            className="modal form-cadastro-modal form-cadastro-modal--md"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Alterar natureza</h2>
            {err && <div className="alert alert-error">{err}</div>}
            {formFields}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditRow(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!draft.code.trim() || !draft.description.trim() || update.isPending}
                onClick={() => update.mutate(editRow.id)}
              >
                Salvar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <RecordViewModal
        open={Boolean(viewRow)}
        title="Natureza — visualização"
        onClose={() => setViewRow(null)}
        sections={
          viewRow
            ? [
                {
                  title: 'Dados',
                  fields: [
                    { label: 'Código', value: viewRow.code },
                    { label: 'CFOP', value: viewRow.cfop },
                    { label: 'Descrição', value: viewRow.description },
                    { label: 'Observações', value: viewRow.notes },
                    { label: 'Status', value: viewRow.isActive ? 'Ativa' : 'Inativa' },
                  ],
                },
              ]
            : []
        }
      />

      {deleteRow && (
        <FormModalBackdrop onClose={() => setDeleteRow(null)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Excluir natureza</h2>
            <p>
              Confirma exclusão de <strong>{deleteRow.code}</strong>?
            </p>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteRow(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleteRow.id)}
              >
                Excluir
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}
    </div>
  );
}
