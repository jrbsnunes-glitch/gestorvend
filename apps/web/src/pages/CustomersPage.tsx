import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AddressFormBlock, EMPTY_ADDRESS, type AddressFormFields } from '../components/AddressFormBlock';
import { CrudToolbar, RowRecordActions } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ListPagination } from '../components/ListPagination';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { CustomerReportsLauncher } from '../components/CustomerReportsLauncher';
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
  creditAvailable?: string;
  requisitionAvailable?: string;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city: string | null;
  state: string | null;
  zip?: string | null;
  cityIbge?: string | null;
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

type CreditSummary = {
  customerId: string;
  customerName: string;
  creditLimit: string;
  requisitionLimit: string;
  creditUsed: string;
  requisitionUsed: string;
  creditAvailable: string;
  requisitionAvailable: string;
};

type CreditAdjustment = {
  id: string;
  kind: 'CREDIT' | 'REQUISITION';
  amount: string;
  balanceAfter: string;
  mode: 'ADD' | 'SET';
  userName: string;
  createdAt: string;
};

function birthDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function parseMoneyInput(raw: string): number {
  return Number(String(raw).replace(',', '.')) || 0;
}

function statementDocumentControl(line: CreditStatement['lines'][number]): string {
  if (line.saleNumber != null) {
    return line.installmentLabel
      ? `${line.saleNumber} · ${line.installmentLabel}`
      : String(line.saleNumber);
  }
  return line.description?.trim() || line.receivableId.slice(0, 8).toUpperCase();
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
  const [limitEditKind, setLimitEditKind] = useState<'CREDIT' | 'REQUISITION' | null>(null);
  const [limitEditMode, setLimitEditMode] = useState<'ADD' | 'SET'>('ADD');
  const [limitEditValue, setLimitEditValue] = useState('');
  const [limitEditErr, setLimitEditErr] = useState<string | null>(null);

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

  const creditSummaryQ = useQuery({
    queryKey: ['customers', editCustomer?.id, 'credit-summary'],
    queryFn: () => api<CreditSummary>(`/customers/${editCustomer!.id}/credit-summary`),
    enabled: Boolean(editOpen && editCustomer?.id),
  });

  const adjustmentsQ = useQuery({
    queryKey: ['customers', editCustomer?.id, 'credit-adjustments', limitEditKind],
    queryFn: () =>
      api<CreditAdjustment[]>(
        `/customers/${editCustomer!.id}/credit-adjustments?kind=${limitEditKind}`,
      ),
    enabled: Boolean(limitEditKind && editCustomer?.id && (limitEditMode === 'ADD' || limitEditKind === 'REQUISITION')),
  });

  const saveLimit = useMutation({
    mutationFn: async () => {
      if (!limitEditKind) return null;
      const value = limitEditValue.replace(',', '.');
      if (Number.isNaN(Number(value)) || Number(value) < 0) {
        throw new Error('Informe um valor válido (zero ou maior).');
      }
      if (limitEditMode === 'ADD' && Number(value) <= 0) {
        throw new Error('Informe um valor maior que zero.');
      }
      if (editOpen && editCustomer) {
        return api<{
          customer: Customer;
          adjustment: CreditAdjustment;
        }>(`/customers/${editCustomer.id}/credit-adjustments`, {
          method: 'POST',
          json: { kind: limitEditKind, amount: value, mode: limitEditMode },
        });
      }
      // Novo cliente (ainda sem id): aplica só no formulário local.
      const current =
        limitEditKind === 'CREDIT'
          ? parseMoneyInput(creditLimit)
          : parseMoneyInput(requisitionLimit);
      const next = limitEditMode === 'ADD' ? current + Number(value) : Number(value);
      return {
        customer: {
          creditLimit: limitEditKind === 'CREDIT' ? String(next) : creditLimit,
          requisitionLimit: limitEditKind === 'REQUISITION' ? String(next) : requisitionLimit,
        } as Customer,
        localOnly: true as const,
      };
    },
    onSuccess: (res) => {
      if (!limitEditKind || !res) return;
      const cust = res.customer;
      if (limitEditKind === 'CREDIT') setCreditLimit(String(cust.creditLimit ?? '0'));
      else setRequisitionLimit(String(cust.requisitionLimit ?? '0'));
      if (editCustomer && 'id' in cust && cust.id) {
        setEditCustomer({ ...editCustomer, ...cust });
      }
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['customers', editCustomer?.id, 'credit-summary'] });
      void qc.invalidateQueries({
        queryKey: ['customers', editCustomer?.id, 'credit-statement'],
      });
      void qc.invalidateQueries({
        queryKey: ['customers', editCustomer?.id, 'credit-adjustments'],
      });
      setLimitEditValue('');
      setLimitEditErr(null);
      // Mantém a janela aberta no modo ADD para ver o histórico; fecha no SET.
      if (limitEditMode === 'SET') {
        setLimitEditKind(null);
      }
    },
    onError: (e: Error) => setLimitEditErr(e.message),
  });

  function openLimitEdit(kind: 'CREDIT' | 'REQUISITION', mode: 'ADD' | 'SET') {
    setLimitEditKind(kind);
    setLimitEditMode(mode);
    setLimitEditValue(mode === 'SET' ? (kind === 'CREDIT' ? creditLimit : requisitionLimit) : '');
    setLimitEditErr(null);
  }

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
      cityIbge: c.cityIbge ?? '',
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
      cityIbge: addr.cityIbge.replace(/\D/g, '').slice(0, 7) || null,
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
      if (editCustomer?.id) {
        void qc.invalidateQueries({ queryKey: ['customers', editCustomer.id, 'credit-summary'] });
      }
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
        showCityIbge
        onChange={(patch) => setAddr((a) => ({ ...a, ...patch }))}
        extra={
          <>
            <div className="customer-limits-panel">
              <div className="form-row form-row--limits">
                <div className="field">
                  <label>Limite de crédito</label>
                  {editOpen && editCustomer && creditSummaryQ.data ? (
                    <strong style={{ fontSize: '0.95rem' }}>
                      Saldo restante: {formatBRL(creditSummaryQ.data.creditAvailable)}
                    </strong>
                  ) : (
                    <strong style={{ fontSize: '0.95rem' }}>
                      Saldo restante: {formatBRL(creditLimit || '0')}
                    </strong>
                  )}
                  <div className="customer-limits-panel__actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ paddingInline: 0 }}
                      onClick={() => openLimitEdit('CREDIT', 'ADD')}
                    >
                      Atualizar Saldo
                    </button>
                    {editOpen && editCustomer && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ paddingInline: 0 }}
                        onClick={() => {
                          setStatementCustomer(editCustomer);
                          setStatementKind('CREDIT');
                        }}
                      >
                        Consultar crédito
                      </button>
                    )}
                  </div>
                </div>
                <div className="field">
                  <label>Limite de requisição</label>
                  {editOpen && editCustomer && creditSummaryQ.data ? (
                    <strong style={{ fontSize: '0.95rem' }}>
                      Saldo restante: {formatBRL(creditSummaryQ.data.requisitionAvailable)}
                    </strong>
                  ) : (
                    <strong style={{ fontSize: '0.95rem' }}>
                      Saldo restante: {formatBRL(requisitionLimit || '0')}
                    </strong>
                  )}
                  <div className="customer-limits-panel__actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ paddingInline: 0 }}
                      onClick={() => openLimitEdit('REQUISITION', 'ADD')}
                    >
                      Valor de Requisição
                    </button>
                    {editOpen && editCustomer && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ paddingInline: 0 }}
                        onClick={() => {
                          setStatementCustomer(editCustomer);
                          setStatementKind('REQUISITION');
                        }}
                      >
                        Consultar requisição
                      </button>
                    )}
                  </div>
                </div>
              </div>
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
          setEditCustomer(null);
          setCreateOpen(true);
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal
        open={reportsOpen}
        title="Clientes"
        wide
        compactLauncher
        onClose={() => setReportsOpen(false)}
      >
        <CustomerReportsLauncher onClose={() => setReportsOpen(false)} />
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
              <th>Req. disponível</th>
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
                <td>{formatBRL(c.requisitionAvailable ?? c.requisitionLimit ?? '0')}</td>
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
          <div
            className="modal modal--wide customer-form-modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
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
          <div
            className="modal modal--wide customer-form-modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
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
                          viewData.cityIbge ? `IBGE ${viewData.cityIbge}` : null,
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
                    <span className="muted">Saldo restante</span>
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
                          <th>Controle do documento</th>
                          <th className="num">Valor total</th>
                          <th className="num">Saldo restante</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statementQ.data.lines.map((line) => (
                          <tr key={line.receivableId}>
                            <td>{formatDate(line.date)}</td>
                            <td>{statementDocumentControl(line)}</td>
                            <td className="num">{formatBRL(line.total)}</td>
                            <td className="num">{formatBRL(line.limitAfter)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (!statementKind) return;
                  openLimitEdit(statementKind, 'ADD');
                }}
              >
                {statementKind === 'CREDIT' ? 'Atualizar Saldo' : 'Valor de Requisição'}
              </button>
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

      {limitEditKind && (
        <FormModalBackdrop
          className="no-print"
          onClose={() => {
            setLimitEditKind(null);
            setLimitEditErr(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(560px, 96vw)', maxHeight: '90vh', overflow: 'auto' }}
          >
            <h2>
              {limitEditKind === 'CREDIT' ? 'Atualizar Saldo' : 'Valor de Requisição'}
            </h2>
            <p className="muted" style={{ marginTop: '-0.35rem' }}>
              {limitEditKind === 'CREDIT'
                ? 'Informe o valor a somar ao saldo restante de crédito.'
                : 'Informe o valor a somar ao limite de requisição do cliente.'}
            </p>
            {editCustomer && (
              <p style={{ margin: '0 0 0.75rem', fontWeight: 600 }}>
                Saldo atual:{' '}
                {formatBRL(
                  limitEditKind === 'CREDIT'
                    ? creditSummaryQ.data?.creditAvailable ?? creditLimit
                    : creditSummaryQ.data?.requisitionAvailable ?? requisitionLimit,
                )}
              </p>
            )}
            {limitEditErr && <div className="alert alert-error">{limitEditErr}</div>}
            <div className="field">
              <label htmlFor="limit-edit-value">Valor a incluir</label>
              <input
                id="limit-edit-value"
                value={limitEditValue}
                onChange={(e) => setLimitEditValue(e.target.value)}
                inputMode="decimal"
                autoFocus
              />
            </div>
            <div className="modal-actions" style={{ marginBottom: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setLimitEditKind(null);
                  setLimitEditErr(null);
                }}
              >
                Fechar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saveLimit.isPending}
                onClick={() => saveLimit.mutate()}
              >
                Salvar
              </button>
            </div>

            {(limitEditMode === 'ADD' || limitEditKind === 'REQUISITION') && (
              <>
                <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>Histórico</h3>
                {!editCustomer ? (
                  <p className="muted">Salve o cliente para registrar o histórico.</p>
                ) : adjustmentsQ.isLoading ? (
                  <p>Carregando…</p>
                ) : adjustmentsQ.isError ? (
                  <div className="alert alert-error">{(adjustmentsQ.error as Error).message}</div>
                ) : !adjustmentsQ.data?.length ? (
                  <p className="muted">Nenhuma inclusão registrada ainda.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Usuário</th>
                          <th>Data</th>
                          <th className="num">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adjustmentsQ.data.map((row) => (
                          <tr key={row.id}>
                            <td>{row.userName}</td>
                            <td>{formatDate(row.createdAt)}</td>
                            <td className="num">{formatBRL(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </FormModalBackdrop>
      )}
    </div>
  );
}
