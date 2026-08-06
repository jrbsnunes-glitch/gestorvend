import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AddressFormBlock, EMPTY_ADDRESS, type AddressFormFields } from '../components/AddressFormBlock';
import { CrudToolbar, RowRecordActions } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ListPagination } from '../components/ListPagination';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { CustomerGroupSearchCombo } from '../components/ProductCatalogCombos';
import { RecordSelectionFooter } from '../components/RecordSelectionFooter';
import { RecordViewModal } from '../components/RecordViewModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { validateDocumentIfCpf } from '../lib/cpf';
import { formatBRL, formatCep, formatCpfCnpj, formatDate } from '../lib/format';
import { useListPagination } from '../hooks/useListPagination';

type Customer = {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  creditLimit: string;
  requisitionLimit?: string;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city: string | null;
  state: string | null;
  zip?: string | null;
  segment?: string | null;
  birthDate?: string | null;
};

type CreditStatement = {
  kind: 'CREDIT' | 'REQUISITION';
  limit: string;
  used: string;
  available: string;
  lines: Array<{
    date: string;
    description: string;
    items: Array<{
      description: string;
      quantity: string;
      unitPrice: string;
      totalLine: string;
    }>;
    quantity: string;
    total: string;
    saleNumber: number | null;
    installmentLabel: string | null;
    amountRemaining: string;
    status: string;
    limitAfter: string;
    receivableId: string;
  }>;
};

function birthDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

export function CustomersPage() {
  const qc = useQueryClient();
  const [viewId, setViewId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [birthDate, setBirthDate] = useState('');
  const [addr, setAddr] = useState<AddressFormFields>(EMPTY_ADDRESS);
  const [creditLimit, setCreditLimit] = useState('0');
  const [requisitionLimit, setRequisitionLimit] = useState('0');
  const [segment, setSegment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [statementKind, setStatementKind] = useState<'CREDIT' | 'REQUISITION' | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);

  const list = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Customer[]>('/customers'),
  });

  const pagination = useListPagination(list.data ?? []);

  const selected = list.data?.find((c) => c.id === viewId) ?? null;
  const selectedRow = list.data?.find((c) => c.id === selectedId) ?? null;

  function toggleSelect(c: Customer) {
    setSelectedId((prev) => (prev === c.id ? null : c.id));
  }

  const detail = useQuery({
    queryKey: ['customers', viewId, 'view'],
    queryFn: () => api<Customer>(`/customers/${viewId}`),
    enabled: viewOpen && !!viewId,
  });

  const statementQ = useQuery({
    queryKey: ['customers', statementCustomer?.id, 'credit-statement', statementKind],
    queryFn: () =>
      api<CreditStatement>(
        `/customers/${statementCustomer!.id}/credit-statement?kind=${statementKind}`,
      ),
    enabled: Boolean(statementCustomer && statementKind),
  });

  function resetForm() {
    setName('');
    setDocument('');
    setEmail('');
    setPhone('');
    setBirthDate('');
    setAddr(EMPTY_ADDRESS);
    setCreditLimit('0');
    setRequisitionLimit('0');
    setSegment('');
    setErr(null);
  }

  function loadSelectedToForm(c: Customer) {
    setName(c.name);
    setDocument(c.document ? formatCpfCnpj(c.document) : '');
    setEmail(c.email ?? '');
    setPhone(c.phone ?? '');
    setBirthDate(birthDateInput(c.birthDate));
    setAddr({
      zip: c.zip ? formatCep(c.zip) : '',
      street: c.street ?? '',
      number: c.number ?? '',
      complement: c.complement ?? '',
      district: c.district ?? '',
      city: c.city ?? '',
      state: c.state ?? '',
    });
    setCreditLimit(c.creditLimit ?? '0');
    setRequisitionLimit(c.requisitionLimit ?? '0');
    setSegment(c.segment ?? '');
    setErr(null);
  }

  function payload() {
    const docErr = validateDocumentIfCpf(document);
    if (docErr) throw new Error(docErr);
    return {
      name,
      document: document.replace(/\D/g, '') || null,
      email: email || null,
      phone: phone || null,
      birthDate: birthDate || null,
      street: addr.street || null,
      number: addr.number || null,
      complement: addr.complement || null,
      district: addr.district || null,
      city: addr.city || null,
      state: addr.state || null,
      zip: addr.zip.replace(/\D/g, '') || null,
      creditLimit: creditLimit.replace(',', '.'),
      requisitionLimit: requisitionLimit.replace(',', '.'),
      segment: segment || null,
    };
  }

  const create = useMutation({
    mutationFn: () => api<Customer>('/customers', { method: 'POST', json: payload() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: (id: string) =>
      api<Customer>(`/customers/${id}`, { method: 'PATCH', json: payload() }),
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
    // Prefer detail for full address if list is partial
    void api<Customer>(`/customers/${c.id}`)
      .then((full) => {
        loadSelectedToForm(full);
        setEditCustomer(full);
        setEditOpen(true);
      })
      .catch(() => {
        loadSelectedToForm(c);
        setEditCustomer(c);
        setEditOpen(true);
      });
  }

  const formFields = (
    <>
      <div className="field">
        <label htmlFor="c-name">Nome *</label>
        <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="c-doc">CPF/CNPJ</label>
          <input
            id="c-doc"
            value={document}
            onChange={(e) => setDocument(formatCpfCnpj(e.target.value))}
            inputMode="numeric"
          />
        </div>
        <div className="field">
          <label htmlFor="c-birth">Data de nascimento</label>
          <input
            id="c-birth"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="c-phone">Telefone</label>
          <input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-email">E-mail</label>
          <input
            id="c-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <AddressFormBlock
        idPrefix="c"
        value={addr}
        onChange={(patch) => setAddr((a) => ({ ...a, ...patch }))}
        extra={
          <>
            <div className="field">
              <label htmlFor="c-limit">Limite de crédito</label>
              <input
                id="c-limit"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
              />
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Valor de crédito dado ao cliente previamente para ser usado em compras na loja.
              </span>
            </div>
            <div className="field">
              <label htmlFor="c-req-limit">Limite de requisição</label>
              <input
                id="c-req-limit"
                value={requisitionLimit}
                onChange={(e) => setRequisitionLimit(e.target.value)}
              />
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Valor que o cliente pode comprar para pagar depois.
              </span>
            </div>
            <div className="field">
              <label htmlFor="c-seg">Grupo</label>
              <CustomerGroupSearchCombo id="c-seg" value={segment} onChange={setSegment} />
            </div>
          </>
        }
      />
    </>
  );

  return (
    <div className={`page print-area${selectedId ? ' page-with-record-footer' : ''}`}>
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
          <li>
            Extrato de limite de crédito / requisição — use o botão Consultar na linha do cliente ou
            no detalhe do cadastro.
          </li>
          <li>Lista de clientes com inadimplência (a implementar)</li>
          <li>Histórico de vendas por cliente</li>
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
              <th>Nome</th>
              <th>CPF/CNPJ</th>
              <th>Contato</th>
              <th>Local</th>
              <th>Lim. crédito</th>
              <th>Lim. requisição</th>
              <th className="col-actions">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={8} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!list.isLoading && !list.data?.length && (
              <tr>
                <td colSpan={8} className="empty">
                  Nenhum cliente cadastrado.
                </td>
              </tr>
            )}
            {pagination.pageItems.map((c, idx) => (
              <tr
                key={c.id}
                className={selectedId === c.id ? 'tr-row-selected' : ''}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('.row-record-actions')) return;
                  toggleSelect(c);
                }}
              >
                <td className="num">{(pagination.page - 1) * pagination.pageSize + idx + 1}</td>
                <td>
                  <strong>{c.name}</strong>
                </td>
                <td>{c.document ? formatCpfCnpj(c.document) : '—'}</td>
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
                <td>{c.city || c.state ? `${c.city ?? ''} ${c.state ?? ''}`.trim() : '—'}</td>
                <td>{formatBRL(c.creditLimit)}</td>
                <td>{formatBRL(c.requisitionLimit ?? '0')}</td>
                <td className="col-actions">
                  <RowRecordActions
                    onEdit={() => openEdit(c)}
                    onView={() => openView(c)}
                    onDelete={() => {
                      setDeleteCustomer(c);
                      setDeleteOpen(true);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStatementCustomer(c);
                      setStatementKind('CREDIT');
                    }}
                  >
                    Consultar crédito
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStatementCustomer(c);
                      setStatementKind('REQUISITION');
                    }}
                  >
                    Consultar requisição
                  </button>
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
          partyType="customer"
          partyId={selectedRow.id}
          partyLabel={selectedRow.name}
          onClear={() => setSelectedId(null)}
        />
      )}

      {createOpen && (
        <FormModalBackdrop
          className="no-print"
          onClose={() => {
            setCreateOpen(false);
            setErr(null);
          }}
        >
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Novo cliente</h2>
            {err && <div className="alert alert-error">{err}</div>}
            {formFields}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!name.trim() || create.isPending}
                onClick={() => {
                  try {
                    create.mutate();
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : 'Erro');
                  }
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {editCustomer && editOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setEditOpen(false)}>
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Alterar cliente</h2>
            {err && <div className="alert alert-error">{err}</div>}
            {formFields}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!name.trim() || update.isPending}
                onClick={() => {
                  try {
                    update.mutate(editCustomer.id);
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : 'Erro');
                  }
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <RecordViewModal
        open={Boolean(viewId && viewOpen)}
        title="Cliente — visualização"
        onClose={() => setViewOpen(false)}
        loading={detail.isLoading}
        error={detail.isError ? (detail.error as Error).message : null}
        sections={
          viewData
            ? [
                {
                  title: 'Dados do cliente',
                  fields: [
                    { label: 'Nome', value: viewData.name },
                    {
                      label: 'Documento',
                      value: viewData.document ? formatCpfCnpj(viewData.document) : null,
                    },
                    {
                      label: 'Nascimento',
                      value: birthDateInput(viewData.birthDate) || null,
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
                    { label: 'Limite de crédito', value: formatBRL(viewData.creditLimit) },
                    {
                      label: 'Limite de requisição',
                      value: formatBRL(viewData.requisitionLimit ?? '0'),
                    },
                    { label: 'Segmento', value: viewData.segment },
                  ],
                },
                {
                  title: 'Consultas de limite',
                  content: (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setStatementCustomer(viewData);
                          setStatementKind('CREDIT');
                        }}
                      >
                        Consultar crédito
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setStatementCustomer(viewData);
                          setStatementKind('REQUISITION');
                        }}
                      >
                        Consultar requisição
                      </button>
                    </div>
                  ),
                },
              ]
            : []
        }
      />

      {deleteCustomer && deleteOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setDeleteOpen(false)}>
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
        </FormModalBackdrop>
      )}

      {statementCustomer && statementKind && (
        <FormModalBackdrop
          className="no-print"
          onClose={() => {
            setStatementCustomer(null);
            setStatementKind(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(720px, 96vw)', maxHeight: '90vh', overflow: 'auto' }}
          >
            <h2>
              Extrato — {statementKind === 'CREDIT' ? 'Limite de crédito' : 'Limite de requisição'}
            </h2>
            <p className="muted" style={{ marginTop: '-0.35rem' }}>
              {statementCustomer.name}
            </p>
            {statementQ.isLoading && <p>Carregando…</p>}
            {statementQ.isError && (
              <div className="alert alert-error">{(statementQ.error as Error).message}</div>
            )}
            {statementQ.data && (
              <>
                <div className="form-row" style={{ marginBottom: '0.75rem' }}>
                  <div className="field" style={{ margin: 0 }}>
                    <span className="muted">Limite</span>
                    <strong>{formatBRL(statementQ.data.limit)}</strong>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <span className="muted">Em uso</span>
                    <strong>{formatBRL(statementQ.data.used)}</strong>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <span className="muted">Disponível</span>
                    <strong>{formatBRL(statementQ.data.available)}</strong>
                  </div>
                </div>
                {!statementQ.data.lines.length ? (
                  <p className="muted">Nenhum uso registrado neste limite.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Item</th>
                          <th className="num">Qtd</th>
                          <th className="num">Total</th>
                          <th>Documento</th>
                          <th className="num">Limite após</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statementQ.data.lines.flatMap((line) => {
                          const doc =
                            line.saleNumber != null
                              ? `Venda #${line.saleNumber}${
                                  line.installmentLabel ? ` · ${line.installmentLabel}` : ''
                                }`
                              : line.description;
                          if (line.items.length) {
                            return line.items.map((it, idx) => (
                              <tr key={`${line.receivableId ?? line.date}-${idx}`}>
                                <td>{idx === 0 ? formatDate(line.date) : ''}</td>
                                <td>{it.description}</td>
                                <td className="num">{it.quantity}</td>
                                <td className="num">{formatBRL(it.totalLine)}</td>
                                <td>{idx === 0 ? doc : ''}</td>
                                <td className="num">
                                  {idx === 0 ? formatBRL(line.limitAfter) : ''}
                                </td>
                              </tr>
                            ));
                          }
                          return [
                            <tr key={line.receivableId ?? line.date}>
                              <td>{formatDate(line.date)}</td>
                              <td>{line.description}</td>
                              <td className="num">{line.quantity}</td>
                              <td className="num">{formatBRL(line.total)}</td>
                              <td>{doc}</td>
                              <td className="num">{formatBRL(line.limitAfter)}</td>
                            </tr>,
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setStatementCustomer(null);
                  setStatementKind(null);
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}
    </div>
  );
}
