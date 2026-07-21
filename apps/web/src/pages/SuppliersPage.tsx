import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CrudToolbar, RowRecordActions } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ListPagination } from '../components/ListPagination';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { RecordSelectionFooter } from '../components/RecordSelectionFooter';
import { RecordViewModal } from '../components/RecordViewModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { useListPagination } from '../hooks/useListPagination';

type Supplier = {
  id: string;
  legalName: string;
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
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
  const [city, setCity] = useState('');
  const [segment, setSegment] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
  });

  const pagination = useListPagination(list.data ?? []);

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
    setCity('');
    setSegment('');
    setErr(null);
  }

  function loadForm(s: Supplier) {
    setLegalName(s.legalName);
    setTradeName(s.tradeName ?? '');
    setDocument(s.document ?? '');
    setEmail(s.email ?? '');
    setPhone(s.phone ?? '');
    setCity(s.city ?? '');
    setSegment(s.segment ?? '');
    setErr(null);
  }

  const create = useMutation({
    mutationFn: () =>
      api<Supplier>('/suppliers', {
        method: 'POST',
        json: {
          legalName,
          tradeName: tradeName || null,
          document: document || null,
          email: email || null,
          phone: phone || null,
          city: city || null,
          segment: segment || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: (id: string) =>
      api<Supplier>(`/suppliers/${id}`, {
        method: 'PATCH',
        json: {
          legalName,
          tradeName: tradeName || null,
          document: document || null,
          email: email || null,
          phone: phone || null,
          city: city || null,
          segment: segment || null,
        },
      }),
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
    loadForm(s);
    setEditSupplier(s);
    setEditOpen(true);
  }

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
        onInclude={() => {
          resetForm();
          setCreateOpen(true);
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal open={reportsOpen} title="Fornecedores" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Compras por fornecedor</li>
          <li>Títulos a pagar em aberto</li>
        </ul>
      </ModuleReportsModal>

      <div className="toolbar no-print">
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {list.data?.length ?? 0} registro(s)
          {selectedId ? ' · clique na linha para selecionar ou desmarcar' : ' · clique em uma linha para selecionar'}
        </span>
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
            {!list.isLoading && !list.data?.length && (
              <tr>
                <td colSpan={7} className="empty">
                  Nenhum fornecedor.
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
                <td>{s.document ?? '—'}</td>
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
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Novo fornecedor</h2>
            {err && <div className="alert alert-error">{err}</div>}
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
                <label htmlFor="s-doc">CNPJ/CPF</label>
                <input id="s-doc" value={document} onChange={(e) => setDocument(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="s-phone">Telefone</label>
                <input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="s-email">E-mail</label>
              <input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="s-city">Cidade</label>
              <input id="s-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="s-seg">Grupo / segmento</label>
              <input
                id="s-seg"
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="Ex.: atacado, mats. construção"
              />
            </div>
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
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Alterar fornecedor</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="field">
              <label htmlFor="se-legal">Razão social *</label>
              <input id="se-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="se-trade">Nome fantasia</label>
              <input id="se-trade" value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="se-doc">CNPJ/CPF</label>
                <input id="se-doc" value={document} onChange={(e) => setDocument(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="se-phone">Telefone</label>
                <input id="se-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="se-email">E-mail</label>
              <input id="se-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="se-city">Cidade</label>
              <input id="se-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="se-seg">Grupo / segmento</label>
              <input
                id="se-seg"
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="Ex.: atacado, mats. construção"
              />
            </div>
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
                    { label: 'Documento', value: viewData.document },
                    { label: 'E-mail', value: viewData.email },
                    { label: 'Telefone', value: viewData.phone },
                    { label: 'Cidade', value: viewData.city },
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
