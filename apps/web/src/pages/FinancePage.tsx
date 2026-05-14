import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';

type Payable = {
  id: string;
  description: string;
  amount: string;
  dueDate: string;
  status: string;
  supplier: { legalName: string } | null;
  recurrence?: 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  recurrenceIndex?: number | null;
  recurrenceCount?: number | null;
};

type Receivable = {
  id: string;
  description: string;
  amount: string;
  dueDate: string;
  status: string;
  customer: { name: string } | null;
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

const EMPTY_FORM: FormState = {
  description: '',
  amount: '',
  dueDate: new Date().toISOString().slice(0, 10),
  partyId: '',
  recurrence: 'NONE',
  recurrenceCount: 12,
};

const RECURRENCE_LABEL: Record<Recurrence, string> = {
  NONE: 'Sem recorrência',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
};

export function FinancePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('pagar');
  const [openTab, setOpenTab] = useState<Tab | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [err, setErr] = useState<string | null>(null);

  const payables = useQuery({
    queryKey: ['payables'],
    queryFn: () => api<Payable[]>('/finance/payables'),
    enabled: tab === 'pagar',
  });

  const receivables = useQuery({
    queryKey: ['receivables'],
    queryFn: () => api<Receivable[]>('/finance/receivables'),
    enabled: tab === 'receber',
  });

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Array<{ id: string; legalName: string }>>('/suppliers'),
  });

  const customers = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/customers'),
  });

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
          recurrenceCount: form.recurrence === 'NONE' ? 1 : form.recurrenceCount,
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
          recurrenceCount: form.recurrence === 'NONE' ? 1 : form.recurrenceCount,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] });
      closeModal();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const payOne = useMutation({
    mutationFn: (id: string) => api(`/finance/payables/${id}/pay`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payables'] }),
  });

  const receiveOne = useMutation({
    mutationFn: (id: string) => api(`/finance/receivables/${id}/receive`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['receivables'] }),
  });

  function openModal(t: Tab) {
    setOpenTab(t);
    setForm(EMPTY_FORM);
    setErr(null);
  }

  function closeModal() {
    setOpenTab(null);
    setForm(EMPTY_FORM);
    setErr(null);
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

  return (
    <div className="page">
      <h1 className="page-title">Financeiro</h1>
      <p className="page-desc">Contas a pagar e a receber. Baixas manuais.</p>

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
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th>Fornecedor</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payables.isLoading && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!payables.isLoading && !payables.data?.length && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Nenhum título.
                    </td>
                  </tr>
                )}
                {payables.data?.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(p.dueDate)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span>{p.description}</span>
                        {recurrenceBadge(p.recurrence, p.recurrenceIndex, p.recurrenceCount)}
                      </div>
                    </td>
                    <td>{p.supplier?.legalName ?? '—'}</td>
                    <td>{formatBRL(p.amount)}</td>
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
                        {p.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {p.status === 'OPEN' && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.82rem' }}
                          disabled={payOne.isPending}
                          onClick={() => payOne.mutate(p.id)}
                        >
                          Baixar
                        </button>
                      )}
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
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th>Cliente</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {receivables.isLoading && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!receivables.isLoading && !receivables.data?.length && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Nenhum título (vendas crediário geram aqui).
                    </td>
                  </tr>
                )}
                {receivables.data?.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.dueDate)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span>{r.description}</span>
                        {recurrenceBadge(r.recurrence, r.recurrenceIndex, r.recurrenceCount)}
                      </div>
                    </td>
                    <td>{r.customer?.name ?? '—'}</td>
                    <td>{formatBRL(r.amount)}</td>
                    <td>
                      <span
                        className={
                          'badge ' + (r.status === 'PAID' ? 'badge-success' : 'badge-warn')
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.status === 'OPEN' && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.82rem' }}
                          disabled={receiveOne.isPending}
                          onClick={() => receiveOne.mutate(r.id)}
                        >
                          Receber
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openTab && (
        <div className="modal-backdrop" role="presentation" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 96vw)' }}>
            <h2>
              {openTab === 'pagar' ? 'Nova conta a pagar' : 'Nova conta a receber'}
            </h2>
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
              <label htmlFor="fp-party">
                {openTab === 'pagar' ? 'Fornecedor' : 'Cliente'}
              </label>
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
                <label htmlFor="fp-amt">Valor *</label>
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
                  {form.recurrence === 'NONE' ? 'Vencimento *' : 'Primeira parcela *'}
                </label>
                <input
                  id="fp-due"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </div>
            </div>

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
              <div className="form-row">
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
                    disabled={form.recurrence === 'NONE'}
                  />
                </div>
              </div>
              {form.recurrence !== 'NONE' && (
                <p style={{ margin: '0.2rem 0 0', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                  Serão geradas <strong>{form.recurrenceCount}</strong> parcelas{' '}
                  {RECURRENCE_LABEL[form.recurrence].toLowerCase()} a partir da data informada.
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
        </div>
      )}
    </div>
  );
}
