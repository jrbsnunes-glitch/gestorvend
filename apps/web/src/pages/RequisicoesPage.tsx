/**
 * Requisições: compras do cliente para pagar depois (limite de requisição).
 * Lista as requisições fechadas no PDV e permite lançar novas fora dele,
 * sempre amarradas a um caixa aberto. Gravar baixa o estoque; cancelar estorna.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { CrudToolbar } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { ProductSearchModal, type ProductSearchRow } from '../components/ProductSearchModal';
import { RecordViewModal, type RecordViewSection } from '../components/RecordViewModal';
import { api } from '../lib/api';

type RequisitionRow = {
  id: string;
  number: number;
  status: 'COMPLETED' | 'CANCELLED' | 'DRAFT';
  source: string;
  createdAt: string;
  total: number;
  notes: string | null;
  itemCount: number;
  installments: number;
  customer: { id: string; name: string; document: string | null } | null;
  operator: string | null;
  cashSession: {
    id: string;
    controlNumber: number;
    status: 'OPEN' | 'CLOSED';
    operator: string | null;
  } | null;
  titles: { total: number; open: number; remaining: number; nextDueDate: string | null };
};

type RequisitionDetail = {
  id: string;
  number: number;
  status: string;
  source: string;
  createdAt: string;
  total: number;
  subtotal: number;
  notes: string | null;
  customer: { id: string; name: string; document: string | null; phone: string | null } | null;
  operator: string | null;
  cashSession: {
    id: string;
    controlNumber: number;
    status: string;
    operator: string | null;
  } | null;
  installments: number;
  items: Array<{
    id: string;
    sku: string;
    productName: string;
    productControlNumber: number;
    quantity: number;
    unitPrice: number;
    totalLine: number;
  }>;
  receivables: Array<{
    id: string;
    description: string;
    status: string;
    amount: number;
    amountRemaining: number;
    dueDate: string;
    recurrenceIndex: number | null;
    recurrenceCount: number | null;
  }>;
};

type OpenSession = {
  id: string;
  controlNumber: number;
  operator: string;
  openedAt: string;
  isMine: boolean;
};

type CustomerRow = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  requisitionLimit?: string;
  requisitionAvailable?: string;
};

type DraftLine = {
  variantId: string;
  label: string;
  quantity: string;
  unitPrice: string;
};

function money(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseNum(value: string): number {
  return parseFloat(String(value).replace(',', '.')) || 0;
}

function formatQty(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function todayInputValue(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dueDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return todayInputValue();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function receivableEditable(r: { status: string; amount: number; amountRemaining: number }) {
  return (r.status === 'OPEN' || r.status === 'OVERDUE') && r.amountRemaining >= r.amount - 0.005;
}

const SOURCE_LABELS: Record<string, string> = {
  PDV: 'PDV',
  REQUISITION: 'Manual',
  WHATSAPP: 'WhatsApp',
  NFE_FORM: 'Formulário NF-e',
  RESTAURANT: 'Salão',
};

const TITLE_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberto',
  OVERDUE: 'Atrasado',
  PAID: 'Pago',
  CANCELLED: 'Cancelado',
};

export function RequisicoesPage() {
  const qc = useQueryClient();
  const [reportsOpen, setReportsOpen] = useState(false);
  const [includeOpen, setIncludeOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editDueDates, setEditDueDates] = useState<Record<string, string>>({});
  const [editErr, setEditErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'CANCELLED'>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [cashSessionId, setCashSessionId] = useState('');
  const [installments, setInstallments] = useState('1');
  const [dueDate, setDueDate] = useState(todayInputValue);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['requisitions', statusFilter, from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      return api<RequisitionRow[]>(`/requisitions${qs ? `?${qs}` : ''}`);
    },
  });

  const detail = useQuery({
    queryKey: ['requisitions', 'detail', viewingId],
    queryFn: () => api<RequisitionDetail>(`/requisitions/${viewingId}`),
    enabled: viewingId != null,
  });

  const editDetail = useQuery({
    queryKey: ['requisitions', 'edit', editingId],
    queryFn: () => api<RequisitionDetail>(`/requisitions/${editingId}`),
    enabled: editingId != null,
  });

  useEffect(() => {
    const d = editDetail.data;
    if (!d || editingId !== d.id) return;
    setEditNotes(d.notes ?? '');
    const dates: Record<string, string> = {};
    for (const r of d.receivables) {
      if (receivableEditable(r)) {
        dates[r.id] = dueDateInput(r.dueDate);
      }
    }
    setEditDueDates(dates);
  }, [editDetail.data, editingId]);

  const openSessions = useQuery({
    queryKey: ['requisitions', 'open-cash-sessions'],
    queryFn: () => api<OpenSession[]>('/requisitions/open-cash-sessions'),
    enabled: includeOpen,
  });

  const customerResults = useQuery({
    queryKey: ['customers', 'search', customerSearch],
    queryFn: () =>
      api<CustomerRow[]>(`/customers/search?q=${encodeURIComponent(customerSearch.trim())}`),
    enabled: customerOpen && customerSearch.trim().length >= 1,
    staleTime: 2_000,
  });

  const creditSummary = useQuery({
    queryKey: ['customers', 'credit-summary', customer?.id],
    queryFn: () =>
      api<{ requisitionLimit: string; requisitionAvailable: string }>(
        `/customers/${customer!.id}/credit-summary`,
      ),
    enabled: includeOpen && customer != null,
  });

  const totals = useMemo(() => {
    const rows = list.data ?? [];
    return {
      count: rows.length,
      total: rows
        .filter((r) => r.status !== 'CANCELLED')
        .reduce((sum, r) => sum + r.total, 0),
      remaining: rows.reduce((sum, r) => sum + r.titles.remaining, 0),
    };
  }, [list.data]);

  const draftTotal = useMemo(
    () => lines.reduce((sum, l) => sum + parseNum(l.quantity) * parseNum(l.unitPrice), 0),
    [lines],
  );

  const availableLimit = creditSummary.data
    ? Number(creditSummary.data.requisitionAvailable)
    : null;
  const overLimit = availableLimit != null && draftTotal > availableLimit + 0.009;

  function resetForm() {
    setCustomer(null);
    setCustomerSearch('');
    setCustomerOpen(false);
    setCashSessionId('');
    setInstallments('1');
    setDueDate(todayInputValue());
    setNotes('');
    setLines([]);
    setErr(null);
  }

  function pickProduct(row: ProductSearchRow) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === row.variantId);
      if (idx >= 0) {
        return prev.map((l, i) =>
          i === idx ? { ...l, quantity: String(parseNum(l.quantity) + 1) } : l,
        );
      }
      return [
        ...prev,
        {
          variantId: row.variantId,
          label: `${row.sku} — ${row.productName}`,
          quantity: '1',
          unitPrice: String(Number(row.retailPrice ?? 0)),
        },
      ];
    });
    setProductSearchOpen(false);
  }

  function setLine(variantId: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
  }

  const createMut = useMutation({
    mutationFn: () =>
      api<{ id: string; number: number }>('/requisitions', {
        method: 'POST',
        json: {
          customerId: customer?.id,
          cashSessionId,
          installments: Math.max(1, parseInt(installments, 10) || 1),
          dueDate,
          notes: notes.trim() || null,
          items: lines.map((l) => ({
            variantId: l.variantId,
            quantity: parseNum(l.quantity),
            unitPrice: parseNum(l.unitPrice),
          })),
        },
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['requisitions'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
      setIncludeOpen(false);
      resetForm();
      alert(`Requisição #${created.number} registrada. O estoque foi baixado.`);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api(`/requisitions/${id}/cancel`, { method: 'POST', json: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requisitions'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
      setViewingId(null);
      alert('Requisição cancelada. Estoque estornado e parcelas removidas.');
    },
    onError: (e: Error) => alert(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      api(`/requisitions/${editingId}`, {
        method: 'PATCH',
        json: {
          notes: editNotes.trim() || null,
          receivables: Object.entries(editDueDates).map(([id, dueDate]) => ({ id, dueDate })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requisitions'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      setEditingId(null);
      setEditErr(null);
      alert('Requisição alterada.');
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  function openEdit(id: string) {
    setEditingId(id);
    setEditErr(null);
  }

  function closeEdit() {
    setEditingId(null);
    setEditNotes('');
    setEditDueDates({});
    setEditErr(null);
  }

  function confirmCancel(row: { id: string; number: number; status: string }) {
    if (row.status === 'CANCELLED') {
      alert('Esta requisição já está cancelada.');
      return;
    }
    const ok = window.confirm(
      `Cancelar a requisição #${row.number}?\n\n` +
        '• Os produtos voltam ao estoque\n' +
        '• As parcelas a receber são removidas (libera o limite do cliente)\n' +
        '• Parcela com baixa parcial ou total impede o cancelamento',
    );
    if (!ok) return;
    cancelMut.mutate(row.id);
  }

  const d = detail.data;
  const viewSections: RecordViewSection[] = d
    ? [
        {
          title: 'Dados da requisição',
          fields: [
            { label: 'Número', value: `#${d.number}` },
            { label: 'Data', value: new Date(d.createdAt).toLocaleString('pt-BR') },
            { label: 'Cliente', value: d.customer?.name ?? null },
            { label: 'CPF/CNPJ', value: d.customer?.document ?? null },
            { label: 'Telefone', value: d.customer?.phone ?? null },
            { label: 'Origem', value: SOURCE_LABELS[d.source] ?? d.source },
            { label: 'Operador', value: d.operator },
            {
              label: 'Caixa',
              value: d.cashSession
                ? `#${d.cashSession.controlNumber} — ${d.cashSession.operator ?? '—'}` +
                  (d.cashSession.status === 'OPEN' ? ' (aberto)' : ' (fechado)')
                : null,
            },
            { label: 'Parcelas', value: `${d.installments}x` },
            {
              label: d.installments > 1 ? 'Primeiro vencimento' : 'Vencimento',
              value: d.receivables[0]?.dueDate
                ? new Date(d.receivables[0].dueDate).toLocaleDateString('pt-BR')
                : null,
            },
            { label: 'Total', value: money(d.total) },
            { label: 'Situação', value: d.status === 'CANCELLED' ? 'Cancelada' : 'Efetivada' },
            { label: 'Observação', value: d.notes },
          ],
        },
        {
          title: `Produtos (${d.items.length})`,
          columns: [
            'Código',
            'Produto',
            'SKU',
            { label: 'Qtd', num: true },
            { label: 'Unitário', num: true },
            { label: 'Total', num: true },
          ],
          rows: d.items.map((it) => [
            it.productControlNumber,
            it.productName,
            it.sku,
            formatQty(it.quantity),
            money(it.unitPrice),
            money(it.totalLine),
          ]),
          empty: 'Nenhum produto.',
        },
        {
          title: `Parcelas (${d.receivables.length})`,
          columns: [
            'Parcela',
            'Vencimento',
            { label: 'Valor', num: true },
            { label: 'Em aberto', num: true },
            'Situação',
          ],
          rows: d.receivables.map((r) => [
            r.recurrenceCount ? `${r.recurrenceIndex}/${r.recurrenceCount}` : '1/1',
            new Date(r.dueDate).toLocaleDateString('pt-BR'),
            money(r.amount),
            money(r.amountRemaining),
            TITLE_STATUS_LABELS[r.status] ?? r.status,
          ]),
          empty: 'Nenhuma parcela gerada.',
        },
      ]
    : [];

  return (
    <div>
      <h1 className="page-title">Requisições</h1>
      <p className="page-desc">
        Compras do cliente para pagar depois, consumindo o limite de requisição. Aqui aparecem as
        requisições fechadas no PDV e as lançadas manualmente — todas vinculadas a um caixa.
      </p>

      <CrudToolbar
        onInclude={() => {
          resetForm();
          setIncludeOpen(true);
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal open={reportsOpen} title="Requisições" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Requisições por cliente e período</li>
          <li>Parcelas em aberto por vencimento (ver Financeiro → Contas a receber)</li>
        </ul>
      </ModuleReportsModal>

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Situação</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'COMPLETED' | 'CANCELLED')}
            >
              <option value="ALL">Todas</option>
              <option value="COMPLETED">Efetivadas</option>
              <option value="CANCELLED">Canceladas</option>
            </select>
          </div>
          <div className="field">
            <label>De</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>Até</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <p className="page-desc">
          {totals.count} requisição(ões) · Total {money(totals.total)} · Em aberto{' '}
          <strong>{money(totals.remaining)}</strong>
        </p>

        {list.isError && <div className="alert alert-error">{(list.error as Error).message}</div>}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Data</th>
                <th>Cliente</th>
                <th>Origem</th>
                <th>Caixa</th>
                <th className="num">Itens</th>
                <th className="num">Parcelas</th>
                <th className="num">Total</th>
                <th className="num">Em aberto</th>
                <th>Situação</th>
                <th className="no-print">Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td colSpan={11} className="empty">
                    Carregando…
                  </td>
                </tr>
              )}
              {!list.isLoading && !(list.data ?? []).length && (
                <tr>
                  <td colSpan={11} className="empty">
                    Nenhuma requisição no período. Use Incluir para lançar fora do PDV.
                  </td>
                </tr>
              )}
              {(list.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td>#{r.number}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                    {new Date(r.createdAt).toLocaleString('pt-BR')}
                  </td>
                  <td>
                    <strong>{r.customer?.name ?? '—'}</strong>
                    {r.customer?.document && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                        {r.customer.document}
                      </div>
                    )}
                  </td>
                  <td>{SOURCE_LABELS[r.source] ?? r.source}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {r.cashSession
                      ? `#${r.cashSession.controlNumber} — ${r.cashSession.operator ?? '—'}`
                      : (r.operator ?? '—')}
                  </td>
                  <td className="num">{r.itemCount}</td>
                  <td className="num">{r.installments}x</td>
                  <td className="num">{money(r.total)}</td>
                  <td className="num">{money(r.titles.remaining)}</td>
                  <td>
                    {r.status === 'CANCELLED' ? (
                      <span className="badge badge-danger">Cancelada</span>
                    ) : r.titles.open > 0 ? (
                      <span className="badge badge-warn">Em aberto</span>
                    ) : (
                      <span className="badge badge-success">Quitada</span>
                    )}
                  </td>
                  <td className="no-print">
                    <div className="row-record-actions no-print">
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() => setViewingId(r.id)}
                      >
                        Visualizar
                      </button>
                      {r.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          disabled={updateMut.isPending}
                          onClick={() => openEdit(r.id)}
                        >
                          Alterar
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-danger btn-compact"
                        disabled={r.status === 'CANCELLED' || cancelMut.isPending}
                        onClick={() => confirmCancel(r)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {includeOpen && (
        <FormModalBackdrop
          className="no-print"
          onClose={() => {
            setIncludeOpen(false);
            setErr(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 780 }}
          >
            <h2>Nova requisição</h2>
            <p className="page-desc" style={{ marginBottom: '1rem' }}>
              O estoque é baixado na gravação e as parcelas entram em Contas a receber, consumindo o
              limite de requisição do cliente.
            </p>
            {err && <div className="alert alert-error">{err}</div>}

            <div className="field">
              <label>Cliente *</label>
              {customer ? (
                <div
                  style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <input readOnly value={customer.name} style={{ flex: '1 1 12rem', minWidth: 0 }} />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setCustomer(null);
                      setCustomerOpen(true);
                    }}
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={customerSearch}
                    placeholder="Nome, CPF/CNPJ ou telefone"
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setCustomerOpen(true);
                    }}
                  />
                  {customerOpen && customerSearch.trim().length >= 1 && (
                    <div className="table-wrap" style={{ maxHeight: '12rem', overflow: 'auto' }}>
                      <table className="data-table">
                        <tbody>
                          {customerResults.isLoading && (
                            <tr>
                              <td className="empty">Buscando…</td>
                            </tr>
                          )}
                          {!customerResults.isLoading && !(customerResults.data ?? []).length && (
                            <tr>
                              <td className="empty">Nenhum cliente encontrado.</td>
                            </tr>
                          )}
                          {(customerResults.data ?? []).map((c) => (
                            <tr key={c.id}>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-compact"
                                  onClick={() => {
                                    setCustomer(c);
                                    setCustomerOpen(false);
                                  }}
                                >
                                  Selecionar
                                </button>
                              </td>
                              <td>
                                <strong>{c.name}</strong>
                                <div
                                  style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}
                                >
                                  {c.document ?? 'sem CPF'} · {c.phone ?? 'sem telefone'}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
              {customer && availableLimit != null && (
                <p className="page-desc" style={{ marginTop: '0.35rem' }}>
                  Limite de requisição disponível: <strong>{money(availableLimit)}</strong>
                </p>
              )}
            </div>

            <div className="form-row">
              <div className="field">
                <label>Caixa aberto *</label>
                <select value={cashSessionId} onChange={(e) => setCashSessionId(e.target.value)}>
                  <option value="">— Selecione —</option>
                  {(openSessions.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.controlNumber} — {s.operator}
                      {s.isMine ? ' (você)' : ''}
                    </option>
                  ))}
                </select>
                {openSessions.data && openSessions.data.length === 0 && (
                  <p className="page-desc" style={{ marginTop: '0.35rem' }}>
                    Nenhum caixa aberto. Abra o caixa antes de lançar a requisição.
                  </p>
                )}
              </div>
              <div className="field">
                <label>Parcelas</label>
                <input
                  value={installments}
                  inputMode="numeric"
                  onChange={(e) => setInstallments(e.target.value)}
                />
              </div>
              <div className="field">
                <label>
                  {Math.max(1, parseInt(installments, 10) || 1) > 1
                    ? 'Primeiro vencimento *'
                    : 'Vencimento *'}
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label>Observação</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                flexWrap: 'wrap',
                margin: '0.5rem 0',
              }}
            >
              <strong style={{ fontSize: '0.95rem' }}>Produtos ({lines.length})</strong>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setProductSearchOpen(true)}
              >
                Pesquisar produto
              </button>
            </div>

            <div className="table-wrap" style={{ maxHeight: '18rem', overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th style={{ width: '7rem' }}>Qtd</th>
                    <th style={{ width: '8rem' }}>Unitário</th>
                    <th className="num" style={{ width: '7rem' }}>
                      Total
                    </th>
                    <th style={{ width: '5rem' }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty">
                        Nenhum produto adicionado. Clique em Pesquisar produto.
                      </td>
                    </tr>
                  )}
                  {lines.map((l) => (
                    <tr key={l.variantId}>
                      <td>{l.label}</td>
                      <td>
                        <input
                          value={l.quantity}
                          inputMode="decimal"
                          onChange={(e) => setLine(l.variantId, { quantity: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          value={l.unitPrice}
                          inputMode="decimal"
                          onChange={(e) => setLine(l.variantId, { unitPrice: e.target.value })}
                        />
                      </td>
                      <td className="num">
                        {money(parseNum(l.quantity) * parseNum(l.unitPrice))}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-compact"
                          onClick={() =>
                            setLines((prev) => prev.filter((x) => x.variantId !== l.variantId))
                          }
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="page-desc" style={{ marginTop: '0.5rem' }}>
              Total da requisição: <strong>{money(draftTotal)}</strong>
            </p>
            {overLimit && (
              <div className="alert alert-error">
                Total acima do limite de requisição disponível ({money(availableLimit ?? 0)}).
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIncludeOpen(false);
                  setErr(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !customer ||
                  !cashSessionId ||
                  !dueDate ||
                  lines.length === 0 ||
                  draftTotal <= 0 ||
                  lines.some((l) => parseNum(l.quantity) <= 0) ||
                  createMut.isPending
                }
                onClick={() => createMut.mutate()}
              >
                Gravar requisição
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {editingId && (
        <FormModalBackdrop className="no-print" onClose={closeEdit}>
          <div
            className="modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640 }}
          >
            <h2>
              {editDetail.data ? `Alterar requisição #${editDetail.data.number}` : 'Alterar requisição'}
            </h2>
            <p className="page-desc" style={{ marginBottom: '1rem' }}>
              Altere observações e vencimentos das parcelas em aberto. Itens, cliente e valores não podem
              ser modificados aqui.
            </p>
            {editErr && <div className="alert alert-error">{editErr}</div>}
            {editDetail.isLoading && <p className="muted">Carregando…</p>}
            {editDetail.isError && (
              <div className="alert alert-error">{(editDetail.error as Error).message}</div>
            )}
            {editDetail.data && (
              <>
                <div className="form-row">
                  <div className="field">
                    <label>Cliente</label>
                    <input readOnly value={editDetail.data.customer?.name ?? '—'} />
                  </div>
                  <div className="field">
                    <label>Total</label>
                    <input readOnly value={money(editDetail.data.total)} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="req-edit-notes">Observações</label>
                  <textarea
                    id="req-edit-notes"
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                </div>
                {editDetail.data.receivables.length > 0 && (
                  <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Parcela</th>
                          <th>Valor</th>
                          <th>Status</th>
                          <th>Vencimento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editDetail.data.receivables.map((rec) => (
                          <tr key={rec.id}>
                            <td>{rec.description}</td>
                            <td className="num">{money(rec.amount)}</td>
                            <td>{TITLE_STATUS_LABELS[rec.status] ?? rec.status}</td>
                            <td>
                              {receivableEditable(rec) ? (
                                <input
                                  type="date"
                                  value={editDueDates[rec.id] ?? dueDateInput(rec.dueDate)}
                                  onChange={(e) =>
                                    setEditDueDates((prev) => ({
                                      ...prev,
                                      [rec.id]: e.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                dueDateInput(rec.dueDate)
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={closeEdit}>
                    Fechar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={updateMut.isPending}
                    onClick={() => updateMut.mutate()}
                  >
                    Salvar
                  </button>
                </div>
              </>
            )}
          </div>
        </FormModalBackdrop>
      )}

      <RecordViewModal
        open={viewingId != null}
        title={d ? `Requisição #${d.number}` : 'Requisição'}
        wide
        loading={detail.isLoading}
        error={detail.isError ? (detail.error as Error).message : null}
        sections={viewSections}
        onClose={() => setViewingId(null)}
      >
        {d && d.status !== 'CANCELLED' ? (
          <div className="modal-actions no-print" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn btn-danger"
              disabled={cancelMut.isPending}
              onClick={() => confirmCancel({ id: d.id, number: d.number, status: d.status })}
            >
              Cancelar requisição
            </button>
          </div>
        ) : null}
      </RecordViewModal>

      <ProductSearchModal
        open={productSearchOpen}
        title="Pesquisar produto para a requisição"
        onClose={() => setProductSearchOpen(false)}
        onPick={pickProduct}
      />
    </div>
  );
}
