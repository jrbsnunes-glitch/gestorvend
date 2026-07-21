import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { CostCenterSelect } from '../components/CostCenterSelect';
import { BillPaymentsButton } from '../components/BillSettlementsModal';
import { api } from '../lib/api';
import { hasInformedPayment, PAYMENT_LABELS, saldoAbertoBill } from '../lib/finance-bills';
import { formatBRL, formatDate } from '../lib/format';

type CashSessionRow = {
  id: string;
  controlNumber: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  userId: string;
  user: { id: string; name: string; email: string } | null;
};

type Payable = {
  id: string;
  description: string;
  amount: string;
  /** Saldo em aberto (o valor ainda não quitado). */
  amountRemaining?: string;
  dueDate: string;
  status: string;
  paidAt?: string | null;
  paymentMethod?: string | null;
  paymentNotes?: string | null;
  settledAmount?: string | null;
  supplier: { legalName: string; segment?: string | null } | null;
  cashSession?: { controlNumber: number; user: { name: string } | null } | null;
  recurrence?: 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  recurrenceIndex?: number | null;
  recurrenceCount?: number | null;
};

type Receivable = {
  id: string;
  description: string;
  amount: string;
  amountRemaining?: string;
  dueDate: string;
  status: string;
  receivedAt?: string | null;
  paymentMethod?: string | null;
  paymentNotes?: string | null;
  settledAmount?: string | null;
  customer: { name: string; segment?: string | null } | null;
  cashSession?: { controlNumber: number; user: { name: string } | null } | null;
  recurrence?: 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  recurrenceIndex?: number | null;
  recurrenceCount?: number | null;
};

type Tab = 'pagar' | 'receber';
type Recurrence = 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

type FormState = {
  description: string;
  amount: string;
  dueDate: string;
  partyId: string;
  recurrence: Recurrence;
  recurrenceCount: number;
};

type SettlementState = {
  amount: string;
  method: string;
  cashSessionId: string;
  notes: string;
  referentialAccountId: string;
};

type PrintModo = 'conta' | 'abertas' | 'pagas';

const EMPTY_FORM: FormState = {
  description: '',
  amount: '',
  dueDate: new Date().toISOString().slice(0, 10),
  partyId: '',
  recurrence: 'NONE',
  recurrenceCount: 1,
};

const EMPTY_SETTLE: SettlementState = {
  amount: '',
  method: 'PIX',
  cashSessionId: '',
  notes: '',
  referentialAccountId: '',
};

const RECURRENCE_LABEL: Record<Recurrence, string> = {
  NONE: 'Sem recorrência',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
};

function statusPt(s: string): string {
  switch (s) {
    case 'OPEN':
      return 'Aberto';
    case 'PAID':
      return 'Pago';
    case 'OVERDUE':
      return 'Vencido';
    case 'CANCELLED':
      return 'Cancelado';
    default:
      return s;
  }
}

function todayLocalStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthRangeDefaults(): { from: string; to: string } {
  const n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth(), 1);
  const end = new Date(n.getFullYear(), n.getMonth() + 1, 0);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export function FinancePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const filterCustomerId = searchParams.get('customerId')?.trim() ?? '';
  const filterSupplierId = searchParams.get('supplierId')?.trim() ?? '';
  const filterPartyName = searchParams.get('partyName')?.trim() ?? '';
  const urlTab = searchParams.get('tab');
  const initialTab: Tab =
    urlTab === 'receber' || filterCustomerId ? 'receber' : urlTab === 'pagar' || filterSupplierId ? 'pagar' : 'pagar';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [openTab, setOpenTab] = useState<Tab | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [err, setErr] = useState<string | null>(null);
  const [settleBill, setSettleBill] = useState<Payable | Receivable | null>(null);
  const [settleForm, setSettleForm] = useState<SettlementState>(EMPTY_SETTLE);
  const [settleErr, setSettleErr] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printModo, setPrintModo] = useState<PrintModo>('abertas');
  const [printId, setPrintId] = useState('');
  const { from: printFromDef, to: printToDef } = monthRangeDefaults();
  const [printFrom, setPrintFrom] = useState(printFromDef);
  const [printTo, setPrintTo] = useState(printToDef);
  const [printSegment, setPrintSegment] = useState('');
  const [printPartyId, setPrintPartyId] = useState('');

  const payables = useQuery({
    queryKey: ['payables', filterSupplierId],
    queryFn: () => {
      const q = filterSupplierId ? `?supplierId=${encodeURIComponent(filterSupplierId)}` : '';
      return api<Payable[]>(`/finance/payables${q}`);
    },
    enabled: tab === 'pagar',
  });

  const receivables = useQuery({
    queryKey: ['receivables', filterCustomerId],
    queryFn: () => {
      const q = filterCustomerId ? `?customerId=${encodeURIComponent(filterCustomerId)}` : '';
      return api<Receivable[]>(`/finance/receivables${q}`);
    },
    enabled: tab === 'receber',
  });

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Array<{ id: string; legalName: string; segment?: string | null }>>('/suppliers'),
  });

  const customers = useQuery({
    queryKey: ['customers'],
    queryFn: () =>
      api<Array<{ id: string; name: string; segment?: string | null }>>('/customers'),
  });

  const openCashSessions = useQuery({
    queryKey: ['cash', 'sessions', 'OPEN', 'finance'],
    queryFn: () => api<CashSessionRow[]>('/cash/sessions?status=OPEN'),
    enabled: !!settleBill,
  });

  const sessionsToday = useMemo(() => {
    const t0 = todayLocalStart();
    return (openCashSessions.data ?? []).filter((s) => isSameLocalDay(new Date(s.openedAt), t0));
  }, [openCashSessions.data]);

  const segmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers.data ?? []) {
      if (c.segment?.trim()) set.add(c.segment.trim());
    }
    for (const s of suppliers.data ?? []) {
      if (s.segment?.trim()) set.add(s.segment.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [customers.data, suppliers.data]);

  const createPayable = useMutation({
    mutationFn: () =>
      api('/finance/payables', {
        method: 'POST',
        json: {
          description: form.description,
          amount: parseFloat(form.amount.replace(',', '.')) || 0,
          dueDate: new Date(form.dueDate).toISOString(),
          supplierId: form.partyId || null,
          recurrence: form.recurrence,
          recurrenceCount: form.recurrenceCount,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] });
      closeModal();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const createReceivable = useMutation({
    mutationFn: () =>
      api('/finance/receivables', {
        method: 'POST',
        json: {
          description: form.description,
          amount: parseFloat(form.amount.replace(',', '.')) || 0,
          dueDate: new Date(form.dueDate).toISOString(),
          customerId: form.partyId || null,
          recurrence: form.recurrence,
          recurrenceCount: form.recurrenceCount,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] });
      closeModal();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const payOne = useMutation({
    mutationFn: ({
      id,
      amount,
      method,
      cashSessionId,
      notes,
      referentialAccountId,
    }: {
      id: string;
      amount: number;
      method: string;
      cashSessionId: string | null;
      notes: string | null;
      referentialAccountId: string | null;
    }) =>
      api(`/finance/payables/${id}/pay`, {
        method: 'PATCH',
        json: {
          amount,
          method,
          cashSessionId: cashSessionId || null,
          notes,
          referentialAccountId,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] });
      closeSettle();
    },
    onError: (e: Error) => setSettleErr(e.message),
  });

  const receiveOne = useMutation({
    mutationFn: ({
      id,
      amount,
      method,
      cashSessionId,
      notes,
      referentialAccountId,
    }: {
      id: string;
      amount: number;
      method: string;
      cashSessionId: string | null;
      notes: string | null;
      referentialAccountId: string | null;
    }) =>
      api(`/finance/receivables/${id}/receive`, {
        method: 'PATCH',
        json: {
          amount,
          method,
          cashSessionId: cashSessionId || null,
          notes,
          referentialAccountId,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] });
      closeSettle();
    },
    onError: (e: Error) => setSettleErr(e.message),
  });

  function openModal(t: Tab) {
    setOpenTab(t);
    setForm({
      ...EMPTY_FORM,
      partyId: t === 'pagar' ? filterSupplierId : filterCustomerId,
    });
    setErr(null);
  }

  function closeModal() {
    setOpenTab(null);
    setForm(EMPTY_FORM);
    setErr(null);
  }

  function saldoAberto(row: Payable | Receivable): string {
    return saldoAbertoBill(row);
  }

  function openSettle(row: Payable | Receivable) {
    setSettleBill(row);
    setSettleForm({
      ...EMPTY_SETTLE,
      amount: saldoAberto(row),
      method: 'PIX',
    });
    setSettleErr(null);
  }

  function closeSettle() {
    setSettleBill(null);
    setSettleForm(EMPTY_SETTLE);
    setSettleErr(null);
  }

  function openPrintModal() {
    const { from, to } = monthRangeDefaults();
    setPrintFrom(from);
    setPrintTo(to);
    setPrintSegment('');
    setPrintPartyId('');
    setPrintModo('abertas');
    setPrintId('');
    setPrintOpen(true);
  }

  function launchPrint() {
    const tipo = tab === 'pagar' ? 'pagar' : 'receber';
    const p = new URLSearchParams();
    p.set('tipo', tipo);
    p.set('modo', printModo);
    if (printModo === 'conta') {
      if (!printId.trim()) {
        return;
      }
      p.set('id', printId.trim());
    } else {
      if (printFrom) p.set('from', printFrom);
      if (printTo) p.set('to', printTo);
      if (printSegment.trim()) p.set('segment', printSegment.trim());
      if (printPartyId) p.set('partyId', printPartyId);
    }
    navigate(`/financeiro/impressao?${p.toString()}`);
    setPrintOpen(false);
  }

  function recurrenceBadge(r?: Payable['recurrence'], idx?: number | null, cnt?: number | null) {
    if (!r || r === 'NONE') return null;
    const label = idx && cnt ? `${idx}/${cnt}` : RECURRENCE_LABEL[r];
    return (
      <span
        className="badge"
        style={{ background: '#eef2ff', color: '#4338ca', fontWeight: 600 }}
        title={`Recorrência: ${RECURRENCE_LABEL[r]}`}
      >
        ⟳ {label}
      </span>
    );
  }

  const printTitle = tab === 'pagar' ? 'Financeiro — contas a pagar' : 'Financeiro — contas a receber';

  return (
    <div className="page print-area">
      <ReportPrintSticker documentTitle={printTitle} />

      <h1 className="page-title">Financeiro</h1>
      <p className="page-desc">Contas a pagar e a receber. Baixa com forma de pagamento e vínculo opcional ao caixa.</p>

      {(filterCustomerId || filterSupplierId) && (
        <div className="card no-print" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem' }}>
              Filtrando por{' '}
              <strong>
                {filterPartyName ||
                  (filterCustomerId
                    ? customers.data?.find((c) => c.id === filterCustomerId)?.name
                    : suppliers.data?.find((s) => s.id === filterSupplierId)?.legalName) ||
                  'registro selecionado'}
              </strong>
            </span>
            <Link
              to={filterCustomerId ? '/clientes' : '/fornecedores'}
              className="btn btn-ghost"
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.65rem' }}
            >
              ← Voltar ao cadastro
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.65rem' }}
              onClick={() => {
                const p = new URLSearchParams();
                if (filterCustomerId) {
                  p.set('customerId', filterCustomerId);
                  if (filterPartyName) p.set('partyName', filterPartyName);
                } else if (filterSupplierId) {
                  p.set('supplierId', filterSupplierId);
                  if (filterPartyName) p.set('partyName', filterPartyName);
                }
                navigate(`/notas-fiscais/parceiro?${p.toString()}`);
              }}
            >
              Notas Fiscais
            </button>
            <Link
              to="/financeiro"
              className="btn btn-ghost"
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.65rem', marginLeft: 'auto' }}
            >
              Limpar filtro
            </Link>
          </div>
        </div>
      )}

      <div className="toolbar" style={{ justifyContent: 'flex-start' }}>
        <button
          type="button"
          className={'btn ' + (tab === 'pagar' ? 'btn-primary' : 'btn-secondary')}
          onClick={() => setTab('pagar')}
          style={{ marginRight: '0.5rem' }}
        >
          A pagar
        </button>
        <button
          type="button"
          className={'btn ' + (tab === 'receber' ? 'btn-primary' : 'btn-secondary')}
          onClick={() => setTab('receber')}
        >
          A receber
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginLeft: 'auto' }}
          onClick={openPrintModal}
        >
          Impressões…
        </button>
      </div>

      {tab === 'pagar' && (
        <>
          <div className="toolbar">
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              {payables.data?.length ?? 0} título(s)
            </span>
            <button type="button" className="btn btn-primary" onClick={() => openModal('pagar')}>
              + Incluir
            </button>
          </div>
          {payables.isError && (
            <div className="alert alert-error">{(payables.error as Error).message}</div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num" style={{ width: '3.2rem' }}>
                    Cont.
                  </th>
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th>Fornecedor</th>
                  <th>Valor (face)</th>
                  <th>Saldo</th>
                  <th>Status</th>
                  <th>Forma / caixa</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payables.isLoading && (
                  <tr>
                    <td colSpan={9} className="empty">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!payables.isLoading && !payables.data?.length && (
                  <tr>
                    <td colSpan={9} className="empty">
                      Nenhum título.
                    </td>
                  </tr>
                )}
                {payables.data?.map((p, idx) => (
                  <tr key={p.id}>
                    <td className="num">{idx + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(p.dueDate)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span>{p.description}</span>
                        {recurrenceBadge(p.recurrence, p.recurrenceIndex, p.recurrenceCount)}
                      </div>
                    </td>
                    <td>{p.supplier?.legalName ?? '—'}</td>
                    <td>{formatBRL(p.amount)}</td>
                    <td>{formatBRL(saldoAberto(p))}</td>
                    <td>
                      <span
                        className={
                          'badge ' +
                          (p.status === 'PAID'
                            ? 'badge-success'
                            : p.status === 'OVERDUE'
                              ? 'badge-danger'
                              : 'badge-warn')
                        }
                      >
                        {statusPt(p.status)}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>
                      {p.status === 'PAID' ? (
                        <>
                          <div>{p.paymentMethod ? PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod : '—'}</div>
                          {p.cashSession && (
                            <div className="no-print" style={{ opacity: 0.85 }}>
                              Caixa #{p.cashSession.controlNumber}{' '}
                              {p.cashSession.user ? `(${p.cashSession.user.name})` : ''}
                            </div>
                          )}
                        </>
                      ) : Number(p.settledAmount ?? 0) > 0 ? (
                        <div>
                          <div>
                            Parcial: {formatBRL(p.settledAmount!)}
                          </div>
                          {p.paymentMethod ? (
                            <div>Último: {PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod}</div>
                          ) : null}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {hasInformedPayment(p) && (
                          <BillPaymentsButton
                            kind="pagar"
                            billId={p.id}
                            description={p.description}
                          />
                        )}
                        {(p.status === 'OPEN' || p.status === 'OVERDUE') && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: '0.82rem' }}
                            disabled={payOne.isPending}
                            onClick={() => openSettle(p)}
                          >
                            Baixar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'receber' && (
        <>
          <div className="toolbar">
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              {receivables.data?.length ?? 0} título(s)
            </span>
            <button type="button" className="btn btn-primary" onClick={() => openModal('receber')}>
              + Incluir
            </button>
          </div>
          {receivables.isError && (
            <div className="alert alert-error">{(receivables.error as Error).message}</div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num" style={{ width: '3.2rem' }}>
                    Cont.
                  </th>
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th>Cliente</th>
                  <th>Valor (face)</th>
                  <th>Saldo</th>
                  <th>Status</th>
                  <th>Forma / caixa</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {receivables.isLoading && (
                  <tr>
                    <td colSpan={9} className="empty">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!receivables.isLoading && !receivables.data?.length && (
                  <tr>
                    <td colSpan={9} className="empty">
                      Nenhum título (vendas crediário geram aqui).
                    </td>
                  </tr>
                )}
                {receivables.data?.map((r, idx) => (
                  <tr key={r.id}>
                    <td className="num">{idx + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.dueDate)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span>{r.description}</span>
                        {recurrenceBadge(r.recurrence, r.recurrenceIndex, r.recurrenceCount)}
                      </div>
                    </td>
                    <td>{r.customer?.name ?? '—'}</td>
                    <td>{formatBRL(r.amount)}</td>
                    <td>{formatBRL(saldoAberto(r))}</td>
                    <td>
                      <span
                        className={
                          'badge ' +
                          (r.status === 'PAID'
                            ? 'badge-success'
                            : r.status === 'OVERDUE'
                              ? 'badge-danger'
                              : 'badge-warn')
                        }
                      >
                        {statusPt(r.status)}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>
                      {r.status === 'PAID' ? (
                        <>
                          <div>{r.paymentMethod ? PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod : '—'}</div>
                          {r.cashSession && (
                            <div className="no-print" style={{ opacity: 0.85 }}>
                              Caixa #{r.cashSession.controlNumber}{' '}
                              {r.cashSession.user ? `(${r.cashSession.user.name})` : ''}
                            </div>
                          )}
                        </>
                      ) : Number(r.settledAmount ?? 0) > 0 ? (
                        <div>
                          <div>Parcial: {formatBRL(r.settledAmount!)}</div>
                          {r.paymentMethod ? (
                            <div>Último: {PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod}</div>
                          ) : null}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {hasInformedPayment(r) && (
                          <BillPaymentsButton
                            kind="receber"
                            billId={r.id}
                            description={r.description}
                          />
                        )}
                        {(r.status === 'OPEN' || r.status === 'OVERDUE') && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: '0.82rem' }}
                            disabled={receiveOne.isPending}
                            onClick={() => openSettle(r)}
                          >
                            Receber
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openTab && (
        <FormModalBackdrop onClose={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 96vw)' }}>
            <h2>{openTab === 'pagar' ? 'Nova conta a pagar' : 'Nova conta a receber'}</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="field">
              <label htmlFor="fp-desc">Descrição *</label>
              <input
                id="fp-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="fp-party">{openTab === 'pagar' ? 'Fornecedor' : 'Cliente'}</label>
              <select
                id="fp-party"
                value={form.partyId}
                onChange={(e) => setForm({ ...form, partyId: e.target.value })}
              >
                <option value="">— Não informado —</option>
                {openTab === 'pagar'
                  ? suppliers.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.legalName}
                      </option>
                    ))
                  : customers.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
              </select>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="fp-amt">
                  {form.recurrence === 'NONE' && form.recurrenceCount > 1 ? 'Valor total *' : 'Valor *'}
                </label>
                <input
                  id="fp-amt"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="fp-due">
                  {form.recurrenceCount > 1 ? '1ª parcela *' : 'Vencimento *'}
                </label>
                <input
                  id="fp-due"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="fp-rec-n">Qtd. de parcelas</label>
                <input
                  id="fp-rec-n"
                  type="number"
                  min={1}
                  max={120}
                  value={form.recurrenceCount}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      recurrenceCount: Math.max(1, Math.min(120, Number(e.target.value) || 1)),
                    })
                  }
                />
              </div>
            </div>
            {form.recurrenceCount > 1 && form.recurrence === 'NONE' && (
              <p style={{ margin: '0 0 0.35rem', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                O valor total será dividido em <strong>{form.recurrenceCount}</strong> parcelas iguais, com
                vencimento mensal a partir da 1ª data.
              </p>
            )}

            <fieldset
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: '0.6rem 0.85rem',
                marginTop: '0.4rem',
              }}
            >
              <legend style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', padding: '0 0.4rem' }}>
                Conta fixa (recorrente)
              </legend>
              <div className="field">
                <label htmlFor="fp-rec">Periodicidade</label>
                <select
                  id="fp-rec"
                  value={form.recurrence}
                  onChange={(e) => setForm({ ...form, recurrence: e.target.value as Recurrence })}
                >
                  {(['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY'] as Recurrence[]).map((r) => (
                    <option key={r} value={r}>
                      {RECURRENCE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              {form.recurrence !== 'NONE' && form.recurrenceCount > 1 && (
                <p style={{ margin: '0.2rem 0 0', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                  Serão geradas <strong>{form.recurrenceCount}</strong> parcelas de{' '}
                  <strong>{form.amount ? formatBRL(parseFloat(form.amount.replace(',', '.')) || 0) : '—'}</strong>{' '}
                  {RECURRENCE_LABEL[form.recurrence].toLowerCase()} a partir da 1ª data.
                </p>
              )}
            </fieldset>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeModal}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !form.description.trim() ||
                  !form.amount ||
                  createPayable.isPending ||
                  createReceivable.isPending
                }
                onClick={() => {
                  if (openTab === 'pagar') createPayable.mutate();
                  else createReceivable.mutate();
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {settleBill && (
        <FormModalBackdrop onClose={closeSettle}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(480px, 96vw)' }}
          >
            <h2 style={{ fontSize: '1.15rem' }}>
              {'supplier' in settleBill ? 'Baixar conta a pagar' : 'Registrar recebimento'}
            </h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginTop: 0 }}>
              {settleBill.description} · venc. {formatDate(settleBill.dueDate)}
            </p>
            <p style={{ fontSize: '0.88rem', marginTop: '0.25rem' }}>
              Valor do título: <strong>{formatBRL(settleBill.amount)}</strong>
              {' · '}
              Saldo em aberto: <strong>{formatBRL(saldoAberto(settleBill))}</strong>
            </p>
            {settleErr && <div className="alert alert-error">{settleErr}</div>}
            <div className="field">
              <label htmlFor="st-amt">Valor deste pagamento / recebimento *</label>
              <input
                id="st-amt"
                type="number"
                step="0.01"
                min="0"
                value={settleForm.amount}
                onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })}
              />
              <small style={{ color: 'var(--color-text-muted)' }}>
                Use até o saldo em aberto. Igual ao saldo quita o título; valor menor deixa o restante em aberto.
                Campo vazio = utilizar o saldo total.
              </small>
            </div>
            <div className="field">
              <label htmlFor="st-method">Forma de pagamento *</label>
              <select
                id="st-method"
                value={settleForm.method}
                onChange={(e) => setSettleForm({ ...settleForm, method: e.target.value })}
              >
                {Object.entries(PAYMENT_LABELS).map(([k, lab]) => (
                  <option key={k} value={k}>
                    {lab}
                  </option>
                ))}
              </select>
            </div>
            <CostCenterSelect
              flow={'supplier' in settleBill ? 'OUT' : 'IN'}
              id="st-cost-center"
              value={settleForm.referentialAccountId}
              onChange={(v) => setSettleForm({ ...settleForm, referentialAccountId: v })}
              label={
                'supplier' in settleBill
                  ? 'Centro de custo — plano referencial (exceto receitas — opcional)'
                  : 'Centro de custo / receita (grupo 6 — opcional)'
              }
            />
            <div className="field">
              <label htmlFor="st-cash">Caixa aberto hoje (opcional)</label>
              <select
                id="st-cash"
                value={settleForm.cashSessionId}
                onChange={(e) => setSettleForm({ ...settleForm, cashSessionId: e.target.value })}
              >
                <option value="">— Não vincular ao caixa —</option>
                {openCashSessions.isLoading && <option disabled>Carregando…</option>}
                {sessionsToday.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.controlNumber} — {s.user?.name ?? s.userId} (aberto{' '}
                    {new Date(s.openedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})
                  </option>
                ))}
              </select>
              {!sessionsToday.length && !openCashSessions.isLoading && (
                <small style={{ color: 'var(--color-text-muted)' }}>
                  Nenhum caixa aberto hoje — a baixa segue sem movimento de caixa.
                </small>
              )}
            </div>
            <div className="field">
              <label htmlFor="st-notes">Observações</label>
              <textarea
                id="st-notes"
                rows={3}
                value={settleForm.notes}
                onChange={(e) => setSettleForm({ ...settleForm, notes: e.target.value })}
                placeholder="Referência bancária, comprovante, etc."
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeSettle}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={payOne.isPending || receiveOne.isPending}
                onClick={() => {
                  const raw = String(settleForm.amount).trim().replace(',', '.');
                  const amt =
                    raw === '' ? Number(saldoAberto(settleBill)) : parseFloat(raw);
                  if (!Number.isFinite(amt) || amt <= 0) {
                    setSettleErr('Informe um valor válido ou deixe em branco para usar o saldo em aberto.');
                    return;
                  }
                  const notes =
                    settleForm.notes.trim() === '' ? null : settleForm.notes.trim().slice(0, 4000);
                  const sid = settleForm.cashSessionId.trim() || null;
                  const refId = settleForm.referentialAccountId.trim() || null;
                  if ('supplier' in settleBill) {
                    payOne.mutate({
                      id: settleBill.id,
                      amount: amt,
                      method: settleForm.method,
                      cashSessionId: sid,
                      notes,
                      referentialAccountId: refId,
                    });
                  } else {
                    receiveOne.mutate({
                      id: settleBill.id,
                      amount: amt,
                      method: settleForm.method,
                      cashSessionId: sid,
                      notes,
                      referentialAccountId: refId,
                    });
                  }
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {printOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setPrintOpen(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(520px, 96vw)' }}
          >
            <h2 style={{ fontSize: '1.15rem' }}>Impressões — {tab === 'pagar' ? 'a pagar' : 'a receber'}</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
              Abre uma nova aba pronta para imprimir (Ctrl+P).
            </p>
            <div className="field">
              <label htmlFor="pr-modo">Tipo de documento</label>
              <select
                id="pr-modo"
                value={printModo}
                onChange={(e) => setPrintModo(e.target.value as PrintModo)}
              >
                <option value="conta">Uma conta (detalhe)</option>
                <option value="abertas">Listagem em aberto (filtros)</option>
                <option value="pagas">Listagem liquidada (filtros)</option>
              </select>
            </div>
            {printModo === 'conta' ? (
              <div className="field">
                <label htmlFor="pr-id">Título</label>
                <select
                  id="pr-id"
                  value={printId}
                  onChange={(e) => setPrintId(e.target.value)}
                >
                  <option value="">— Selecione —</option>
                  {tab === 'pagar'
                    ? payables.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {formatDate(p.dueDate)} · saldo {formatBRL(saldoAberto(p))} ·{' '}
                          {p.description.slice(0, 60)}
                        </option>
                      ))
                    : receivables.data?.map((r) => (
                        <option key={r.id} value={r.id}>
                          {formatDate(r.dueDate)} · saldo {formatBRL(saldoAberto(r))} ·{' '}
                          {r.description.slice(0, 60)}
                        </option>
                      ))}
                </select>
              </div>
            ) : (
              <>
                <div className="form-row">
                  <div className="field">
                    <label htmlFor="pr-from">De</label>
                    <input
                      id="pr-from"
                      type="date"
                      value={printFrom}
                      onChange={(e) => setPrintFrom(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="pr-to">Até</label>
                    <input
                      id="pr-to"
                      type="date"
                      value={printTo}
                      onChange={(e) => setPrintTo(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="pr-seg">Grupo (segmento {tab === 'pagar' ? 'do fornecedor' : 'do cliente'})</label>
                  <input
                    id="pr-seg"
                    list="seg-list-finance"
                    value={printSegment}
                    onChange={(e) => setPrintSegment(e.target.value)}
                    placeholder="Opcional"
                  />
                  <datalist id="seg-list-finance">
                    {segmentOptions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="pr-party">
                    {tab === 'pagar' ? 'Fornecedor específico' : 'Cliente específico'}
                  </label>
                  <select
                    id="pr-party"
                    value={printPartyId}
                    onChange={(e) => setPrintPartyId(e.target.value)}
                  >
                    <option value="">— Todos —</option>
                    {tab === 'pagar'
                      ? suppliers.data?.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.legalName}
                          </option>
                        ))
                      : customers.data?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                  </select>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPrintOpen(false)}>
                Fechar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={printModo === 'conta' && !printId}
                onClick={launchPrint}
              >
                Abrir para imprimir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
