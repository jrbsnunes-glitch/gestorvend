import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { AddressFormBlock, EMPTY_ADDRESS, type AddressFormFields } from '../components/AddressFormBlock';
import { CrudSearchFilterLeading } from '../components/CrudSearchFilterLeading';
import { CrudToolbar, RowRecordActions } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ListPagination } from '../components/ListPagination';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { RecordSelectionFooter } from '../components/RecordSelectionFooter';
import { RecordViewModal } from '../components/RecordViewModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { formatCep, formatCnpj, formatCpfCnpj } from '../lib/format';
import { lookupCnpj } from '../lib/lookups';
import { useListPagination } from '../hooks/useListPagination';
import {
  FilterControlRangeFields,
  FilterGroupField,
  FilterModalActions,
} from '../components/ListFilterFields';
import { applyControlRangeSlice, controlRangeActive } from '../lib/list-filters';
import { matchesListSearch } from '../lib/list-search';

type Supplier = {
  id: string;
  legalName: string;
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city: string | null;
  state?: string | null;
  zip?: string | null;
  segment: string | null;
};

export function SuppliersPage() {
  const qc = useQueryClient();
  const [viewId, setViewId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [deleteSupplier, setDeleteSupplier] = useState<Supplier | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [document, setDocument] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addr, setAddr] = useState<AddressFormFields>(EMPTY_ADDRESS);
  const [segment, setSegment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [cnpjBusy, setCnpjBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [draftFilterCity, setDraftFilterCity] = useState('');
  const [draftFilterState, setDraftFilterState] = useState('');
  const [draftFilterGroup, setDraftFilterGroup] = useState('');
  const [draftControlMin, setDraftControlMin] = useState('');
  const [draftControlMax, setDraftControlMax] = useState('');
  const [appliedFilterCity, setAppliedFilterCity] = useState('');
  const [appliedFilterState, setAppliedFilterState] = useState('');
  const [appliedFilterGroup, setAppliedFilterGroup] = useState('');
  const [appliedControlMin, setAppliedControlMin] = useState('');
  const [appliedControlMax, setAppliedControlMax] = useState('');

  const list = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
  });

  const filteredList = useMemo(() => {
    let items = list.data ?? [];
    const q = appliedSearch.trim();
    if (q) {
      items = items.filter((s) =>
        matchesListSearch([s.legalName, s.tradeName, s.document, s.email, s.city], q),
      );
    }
    const city = appliedFilterCity.trim();
    const state = appliedFilterState.trim();
    if (city) items = items.filter((s) => matchesListSearch([s.city], city));
    if (state) items = items.filter((s) => matchesListSearch([s.state], state));
    const group = appliedFilterGroup.trim();
    if (group) items = items.filter((s) => matchesListSearch([s.segment], group));
    return applyControlRangeSlice(items, appliedControlMin, appliedControlMax);
  }, [
    list.data,
    appliedSearch,
    appliedFilterCity,
    appliedFilterState,
    appliedFilterGroup,
    appliedControlMin,
    appliedControlMax,
  ]);

  const filtersActive =
    appliedFilterCity.trim() !== '' ||
    appliedFilterState.trim() !== '' ||
    appliedFilterGroup.trim() !== '' ||
    controlRangeActive({ controlMin: appliedControlMin, controlMax: appliedControlMax });
  const searchActive = appliedSearch.trim() !== '';

  const pagination = useListPagination(filteredList);

  const selected = list.data?.find((s) => s.id === viewId) ?? null;
  const selectedRow = list.data?.find((s) => s.id === selectedId) ?? null;

  function toggleSelect(s: Supplier) {
    setSelectedId((prev) => (prev === s.id ? null : s.id));
  }

  const detail = useQuery({
    queryKey: ['suppliers', viewId, 'view'],
    queryFn: () => api<Supplier>(`/suppliers/${viewId}`),
    enabled: viewOpen && !!viewId,
  });

  function resetForm() {
    setLegalName('');
    setTradeName('');
    setDocument('');
    setEmail('');
    setPhone('');
    setAddr(EMPTY_ADDRESS);
    setSegment('');
    setErr(null);
  }

  function loadForm(s: Supplier) {
    setLegalName(s.legalName);
    setTradeName(s.tradeName ?? '');
    setDocument(s.document ? formatCpfCnpj(s.document) : '');
    setEmail(s.email ?? '');
    setPhone(s.phone ?? '');
    setAddr({
      zip: s.zip ? formatCep(s.zip) : '',
      street: s.street ?? '',
      number: s.number ?? '',
      complement: s.complement ?? '',
      district: s.district ?? '',
      city: s.city ?? '',
      state: s.state ?? '',
      cityIbge: '',
    });
    setSegment(s.segment ?? '');
    setErr(null);
  }

  function payload() {
    return {
      legalName,
      tradeName: tradeName || null,
      document: document.replace(/\D/g, '') || null,
      email: email || null,
      phone: phone || null,
      street: addr.street || null,
      number: addr.number || null,
      complement: addr.complement || null,
      district: addr.district || null,
      city: addr.city || null,
      state: addr.state || null,
      zip: addr.zip.replace(/\D/g, '') || null,
      segment: segment || null,
    };
  }

  async function buscarCnpj() {
    setErr(null);
    const digits = document.replace(/\D/g, '');
    if (digits.length !== 14) {
      setErr('Informe um CNPJ com 14 dígitos para buscar na BrasilAPI.');
      return;
    }
    setCnpjBusy(true);
    try {
      const data = await lookupCnpj(digits);
      setDocument(formatCnpj(data.document));
      setLegalName(data.legalName || legalName);
      setTradeName(data.tradeName || tradeName);
      if (data.email) setEmail(data.email);
      if (data.phone) setPhone(data.phone);
      setAddr({
        zip: data.zip ? formatCep(data.zip) : addr.zip,
        street: data.street || addr.street,
        number: data.number || addr.number,
        complement: data.complement || addr.complement,
        district: data.district || addr.district,
        city: data.city || addr.city,
        state: data.state || addr.state,
        cityIbge: addr.cityIbge,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao consultar CNPJ.');
    } finally {
      setCnpjBusy(false);
    }
  }

  const create = useMutation({
    mutationFn: () => api<Supplier>('/suppliers', { method: 'POST', json: payload() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: (id: string) =>
      api<Supplier>(`/suppliers/${id}`, { method: 'PATCH', json: payload() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setEditOpen(false);
      setEditSupplier(null);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setDeleteOpen(false);
      setDeleteSupplier(null);
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const viewData = detail.data ?? selected;

  function openView(s: Supplier) {
    setViewId(s.id);
    setViewOpen(true);
  }

  function openEdit(s: Supplier) {
    void api<Supplier>(`/suppliers/${s.id}`)
      .then((full) => {
        loadForm(full);
        setEditSupplier(full);
        setEditOpen(true);
      })
      .catch(() => {
        loadForm(s);
        setEditSupplier(s);
        setEditOpen(true);
      });
  }

  const formFields = (
    <>
      <div className="form-row" style={{ alignItems: 'flex-end' }}>
        <div className="field">
          <label htmlFor="s-doc">CNPJ/CPF</label>
          <input
            id="s-doc"
            value={document}
            onChange={(e) => setDocument(formatCpfCnpj(e.target.value))}
            inputMode="numeric"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginBottom: '0.15rem' }}
          disabled={cnpjBusy}
          onClick={() => void buscarCnpj()}
          title="Consulta pública BrasilAPI"
        >
          {cnpjBusy ? 'Buscando…' : 'Buscar CNPJ'}
        </button>
      </div>
      <div className="field">
        <label htmlFor="s-legal">Razão social *</label>
        <input
          id="s-legal"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="s-trade">Nome fantasia</label>
        <input id="s-trade" value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="s-phone">Telefone</label>
          <input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-email">E-mail</label>
          <input
            id="s-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <AddressFormBlock
        idPrefix="s"
        value={addr}
        onChange={(patch) => setAddr((a) => ({ ...a, ...patch }))}
        extra={
          <div className="field">
            <label htmlFor="s-seg">Grupo / segmento</label>
            <input
              id="s-seg"
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              placeholder="Ex.: atacado, mats. construção"
            />
          </div>
        }
      />
    </>
  );

  return (
    <div className={`page print-area${selectedId ? ' page-with-record-footer' : ''}`}>
      <h1 className="page-title">Fornecedores</h1>
      <p className="page-desc">Cadastro fiscal e comercial de fornecedores.</p>

      <ReportPrintSticker
        documentTitle="Fornecedores"
        documentExtras={
          <p className="print-sub page-desc" style={{ marginBottom: 0 }}>
            Lista atual do cadastro. Impressões servem apenas como cópia de trabalho até haver relatório formal
            no módulo.
          </p>
        }
      />

      <CrudToolbar
        leadingPrimary={
          <CrudSearchFilterLeading
            onSearch={() => {
              setDraftSearch(appliedSearch);
              setSearchOpen(true);
            }}
            onFilters={() => {
              setDraftFilterCity(appliedFilterCity);
              setDraftFilterState(appliedFilterState);
              setDraftFilterGroup(appliedFilterGroup);
              setDraftControlMin(appliedControlMin);
              setDraftControlMax(appliedControlMax);
              setFiltersOpen(true);
            }}
            filtersActive={filtersActive}
          />
        }
        onInclude={() => {
          resetForm();
          setCreateOpen(true);
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
      />

      {searchOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setSearchOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2>Pesquisar fornecedores</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
              Razão social, fantasia, documento, e-mail ou cidade.
            </p>
            <div className="field">
              <label htmlFor="sup-search-q">Termo</label>
              <input
                id="sup-search-q"
                type="search"
                autoFocus
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                placeholder="Ex.: Materiais, CNPJ…"
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
          <div
            className="modal modal--filters-compact"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Filtros da listagem</h2>
            <FilterControlRangeFields
              idPrefix="sup"
              controlMin={draftControlMin}
              controlMax={draftControlMax}
              onControlMinChange={setDraftControlMin}
              onControlMaxChange={setDraftControlMax}
            />
            <FilterGroupField id="sup-filter-group" value={draftFilterGroup} onChange={setDraftFilterGroup} />
            <div className="form-row form-row--2 filter-modal-row">
              <div className="field">
                <label htmlFor="sup-filter-city">Cidade</label>
                <input
                  id="sup-filter-city"
                  value={draftFilterCity}
                  onChange={(e) => setDraftFilterCity(e.target.value)}
                  placeholder="Opc."
                />
              </div>
              <div className="field">
                <label htmlFor="sup-filter-state">UF</label>
                <input
                  id="sup-filter-state"
                  value={draftFilterState}
                  onChange={(e) => setDraftFilterState(e.target.value)}
                  placeholder="Opc."
                  maxLength={2}
                />
              </div>
            </div>
            <FilterModalActions
              onClear={() => {
                setDraftFilterCity('');
                setDraftFilterState('');
                setDraftFilterGroup('');
                setDraftControlMin('');
                setDraftControlMax('');
                setAppliedFilterCity('');
                setAppliedFilterState('');
                setAppliedFilterGroup('');
                setAppliedControlMin('');
                setAppliedControlMax('');
                setFiltersOpen(false);
              }}
              onCancel={() => setFiltersOpen(false)}
              onApply={() => {
                setAppliedFilterCity(draftFilterCity.trim());
                setAppliedFilterState(draftFilterState.trim());
                setAppliedFilterGroup(draftFilterGroup.trim());
                setAppliedControlMin(draftControlMin.trim());
                setAppliedControlMax(draftControlMax.trim());
                setFiltersOpen(false);
              }}
            />
          </div>
        </FormModalBackdrop>
      )}

      <ModuleReportsModal open={reportsOpen} title="Fornecedores" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Compras por fornecedor</li>
          <li>Títulos a pagar em aberto</li>
        </ul>
      </ModuleReportsModal>

      <div className="toolbar no-print">
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {list.data?.length ?? 0} registro(s)
          {(searchActive || filtersActive) ? ` · filtrado: ${pagination.totalItems}` : ''}
          {selectedId ? ' · clique na linha para selecionar ou desmarcar' : ' · clique em uma linha para selecionar'}
        </span>
        {(searchActive || filtersActive) && (
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => {
              setAppliedSearch('');
              setAppliedFilterCity('');
              setAppliedFilterState('');
              setAppliedFilterGroup('');
              setAppliedControlMin('');
              setAppliedControlMax('');
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {list.isError && <div className="alert alert-error">{(list.error as Error).message}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="num" style={{ width: '3.2rem' }}>
                Cont.
              </th>
              <th>Razão social</th>
              <th>Nome fantasia</th>
              <th>CNPJ/CPF</th>
              <th>Contato</th>
              <th>Cidade</th>
              <th className="col-actions">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={7} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!list.isLoading && !filteredList.length && (
              <tr>
                <td colSpan={7} className="empty">
                  {list.data?.length ? 'Nenhum fornecedor com os filtros atuais.' : 'Nenhum fornecedor.'}
                </td>
              </tr>
            )}
            {pagination.pageItems.map((s, idx) => (
              <tr
                key={s.id}
                className={selectedId === s.id ? 'tr-row-selected' : ''}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('.row-record-actions')) return;
                  toggleSelect(s);
                }}
              >
                <td className="num">{(pagination.page - 1) * pagination.pageSize + idx + 1}</td>
                <td>
                  <strong>{s.legalName}</strong>
                </td>
                <td>{s.tradeName ?? '—'}</td>
                <td>{s.document ? formatCpfCnpj(s.document) : '—'}</td>
                <td>
                  {s.email || s.phone ? (
                    <>
                      {s.email && <div>{s.email}</div>}
                      {s.phone && <div style={{ color: 'var(--color-text-muted)' }}>{s.phone}</div>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{s.city ?? '—'}</td>
                <td className="col-actions">
                  <RowRecordActions
                    onEdit={() => openEdit(s)}
                    onView={() => openView(s)}
                    onDelete={() => {
                      setDeleteSupplier(s);
                      setDeleteOpen(true);
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

      {selectedRow && (
        <RecordSelectionFooter
          partyType="supplier"
          partyId={selectedRow.id}
          partyLabel={selectedRow.legalName}
          onClear={() => setSelectedId(null)}
        />
      )}

      {createOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setCreateOpen(false)}>
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Novo fornecedor</h2>
            {err && <div className="alert alert-error">{err}</div>}
            {formFields}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!legalName.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                Salvar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {editSupplier && editOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setEditOpen(false)}>
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Alterar fornecedor</h2>
            {err && <div className="alert alert-error">{err}</div>}
            {formFields}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!legalName.trim() || update.isPending}
                onClick={() => update.mutate(editSupplier.id)}
              >
                Salvar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <RecordViewModal
        open={Boolean(viewId && viewOpen)}
        title="Fornecedor — visualização"
        onClose={() => setViewOpen(false)}
        loading={detail.isLoading}
        error={detail.isError ? (detail.error as Error).message : null}
        sections={
          viewData
            ? [
                {
                  title: 'Dados do fornecedor',
                  fields: [
                    { label: 'Razão social', value: viewData.legalName },
                    { label: 'Nome fantasia', value: viewData.tradeName },
                    {
                      label: 'Documento',
                      value: viewData.document ? formatCpfCnpj(viewData.document) : null,
                    },
                    { label: 'E-mail', value: viewData.email },
                    { label: 'Telefone', value: viewData.phone },
                    {
                      label: 'Endereço',
                      value:
                        [
                          viewData.street,
                          viewData.number,
                          viewData.complement,
                          viewData.district,
                          [viewData.city, viewData.state].filter(Boolean).join('/'),
                          viewData.zip ? `CEP ${formatCep(viewData.zip)}` : null,
                        ]
                          .filter(Boolean)
                          .join(', ') || null,
                    },
                    { label: 'Segmento', value: viewData.segment },
                  ],
                },
              ]
            : []
        }
      />

      {deleteSupplier && deleteOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setDeleteOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Excluir fornecedor</h2>
            <p>
              Confirma a exclusão de <strong>{deleteSupplier.legalName}</strong>?
            </p>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleteSupplier.id)}
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
