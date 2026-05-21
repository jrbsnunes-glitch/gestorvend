import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CrudToolbar, RowRecordActions } from '../components/CrudToolbar';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';

type Customer = {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  creditLimit: string;
  city: string | null;
  state: string | null;
  segment?: string | null;
};

export function CustomersPage() {
  const qc = useQueryClient();
  const [viewId, setViewId] = useState<string | null>(null);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('');
  const [creditLimit, setCreditLimit] = useState('0');
  const [segment, setSegment] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Customer[]>('/customers'),
  });

  const selected = list.data?.find((c) => c.id === viewId) ?? null;

  const detail = useQuery({
    queryKey: ['customers', viewId, 'view'],
    queryFn: () => api<Customer>(`/customers/${viewId}`),
    enabled: viewOpen && !!viewId,
  });

  function resetForm() {
    setName('');
    setDocument('');
    setEmail('');
    setPhone('');
    setCity('');
    setStateUf('');
    setCreditLimit('0');
    setSegment('');
    setErr(null);
  }

  function loadSelectedToForm(c: Customer) {
    setName(c.name);
    setDocument(c.document ?? '');
    setEmail(c.email ?? '');
    setPhone(c.phone ?? '');
    setCity(c.city ?? '');
    setStateUf(c.state ?? '');
    setCreditLimit(c.creditLimit ?? '0');
    setSegment(c.segment ?? '');
    setErr(null);
  }

  const create = useMutation({
    mutationFn: () =>
      api<Customer>('/customers', {
        method: 'POST',
        json: {
          name,
          document: document || null,
          email: email || null,
          phone: phone || null,
          city: city || null,
          state: stateUf || null,
          creditLimit: creditLimit.replace(',', '.'),
          segment: segment || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: (id: string) =>
      api<Customer>(`/customers/${id}`, {
        method: 'PATCH',
        json: {
          name,
          document: document || null,
          email: email || null,
          phone: phone || null,
          city: city || null,
          state: stateUf || null,
          creditLimit: creditLimit.replace(',', '.'),
          segment: segment || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setEditOpen(false);
      setEditCustomer(null);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setDeleteOpen(false);
      setDeleteCustomer(null);
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const viewData = detail.data ?? selected;

  function openView(c: Customer) {
    setViewId(c.id);
    setViewOpen(true);
  }

  function openEdit(c: Customer) {
    loadSelectedToForm(c);
    setEditCustomer(c);
    setEditOpen(true);
  }

  return (
    <div className="page print-area">
      <h1 className="page-title">Clientes</h1>
      <p className="page-desc">Cadastro de clientes para vendas e contas a receber.</p>

      <ReportPrintSticker
        documentTitle="Clientes"
        documentExtras={
          <p className="print-sub page-desc" style={{ marginBottom: 0 }}>
            Lista de cadastro ao momento da impressão. Ocultamos barras da interface via estilos de impressão.
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

      <ModuleReportsModal open={reportsOpen} title="Clientes" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Lista de clientes com inadimplência (a implementar)</li>
          <li>Histórico de vendas por cliente</li>
        </ul>
      </ModuleReportsModal>

      <div className="toolbar no-print">
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {list.data?.length ?? 0} registro(s)
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
              <th>Nome</th>
              <th>CPF/CNPJ</th>
              <th>Contato</th>
              <th>Local</th>
              <th>Limite</th>
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
                  Nenhum cliente cadastrado.
                </td>
              </tr>
            )}
            {list.data?.map((c, idx) => (
              <tr key={c.id}>
                <td className="num">{idx + 1}</td>
                <td>
                  <strong>{c.name}</strong>
                </td>
                <td>{c.document ?? '—'}</td>
                <td>
                  {c.email || c.phone ? (
                    <>
                      {c.email && <div>{c.email}</div>}
                      {c.phone && <div style={{ color: 'var(--color-text-muted)' }}>{c.phone}</div>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {c.city || c.state ? `${c.city ?? ''} ${c.state ?? ''}`.trim() : '—'}
                </td>
                <td>{formatBRL(c.creditLimit)}</td>
                <td className="col-actions">
                  <RowRecordActions
                    onEdit={() => openEdit(c)}
                    onView={() => openView(c)}
                    onDelete={() => {
                      setDeleteCustomer(c);
                      setDeleteOpen(true);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <div
          className="modal-backdrop no-print"
          role="presentation"
          onClick={() => {
            setCreateOpen(false);
            setErr(null);
          }}
        >
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Novo cliente</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="field">
              <label htmlFor="c-name">Nome *</label>
              <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="c-doc">CPF/CNPJ</label>
                <input id="c-doc" value={document} onChange={(e) => setDocument(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="c-phone">Telefone</label>
                <input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="c-email">E-mail</label>
              <input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="c-city">Cidade</label>
                <input id="c-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="c-uf">UF</label>
                <input id="c-uf" value={stateUf} onChange={(e) => setStateUf(e.target.value)} maxLength={2} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="c-limit">Limite de crédito</label>
              <input id="c-limit" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-seg">Grupo / segmento</label>
              <input
                id="c-seg"
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="Ex.: varejo, cooperativas"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {editCustomer && editOpen && (
        <div className="modal-backdrop no-print" role="presentation" onClick={() => setEditOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Alterar cliente</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="field">
              <label htmlFor="ce-name">Nome *</label>
              <input id="ce-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="ce-doc">CPF/CNPJ</label>
                <input id="ce-doc" value={document} onChange={(e) => setDocument(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ce-phone">Telefone</label>
                <input id="ce-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="ce-email">E-mail</label>
              <input id="ce-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="ce-city">Cidade</label>
                <input id="ce-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ce-uf">UF</label>
                <input id="ce-uf" value={stateUf} onChange={(e) => setStateUf(e.target.value)} maxLength={2} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="ce-limit">Limite de crédito</label>
              <input id="ce-limit" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ce-seg">Grupo / segmento</label>
              <input
                id="ce-seg"
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="Ex.: varejo, cooperativas"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!name.trim() || update.isPending}
                onClick={() => update.mutate(editCustomer.id)}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {viewId && viewOpen && viewData && (
        <div className="modal-backdrop no-print" role="presentation" onClick={() => setViewOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Cliente — visualização</h2>
            {detail.isLoading && <p>Carregando…</p>}
            {detail.isError && (
              <div className="alert alert-error">{(detail.error as Error).message}</div>
            )}
            {!detail.isLoading && !detail.isError && (
              <>
                <p>
                  <strong>Nome:</strong> {viewData.name}
                </p>
                <p>
                  <strong>Documento:</strong> {viewData.document ?? '—'}
                </p>
                <p>
                  <strong>E-mail:</strong> {viewData.email ?? '—'}
                </p>
                <p>
                  <strong>Telefone:</strong> {viewData.phone ?? '—'}
                </p>
                <p>
                  <strong>Cidade / UF:</strong>{' '}
                  {[viewData.city, viewData.state].filter(Boolean).join(' / ') || '—'}
                </p>
                <p>
                  <strong>Limite:</strong> {formatBRL(viewData.creditLimit)}
                </p>
                <p>
                  <strong>Segmento:</strong> {viewData.segment ?? '—'}
                </p>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setViewOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteCustomer && deleteOpen && (
        <div className="modal-backdrop no-print" role="presentation" onClick={() => setDeleteOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Excluir cliente</h2>
            <p>
              Confirma a exclusão de <strong>{deleteCustomer.name}</strong>?
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
                onClick={() => remove.mutate(deleteCustomer.id)}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
