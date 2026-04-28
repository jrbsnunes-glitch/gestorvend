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
};

type Receivable = {
  id: string;
  description: string;
  amount: string;
  dueDate: string;
  status: string;
  customer: { name: string } | null;
};

export function FinancePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pagar' | 'receber'>('pagar');
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState('');
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

  const createPayable = useMutation({
    mutationFn: () =>
      api('/finance/payables', {
        method: 'POST',
        json: {
          description: desc,
          amount: parseFloat(amount.replace(',', '.')) || 0,
          dueDate: new Date(due).toISOString(),
          supplierId: supplierId || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] });
      setOpen(false);
      setDesc('');
      setAmount('');
      setSupplierId('');
      setErr(null);
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
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              Nova despesa
            </button>
          </div>
          {payables.isError && <div className="alert alert-error">{(payables.error as Error).message}</div>}
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
                    <td>{p.description}</td>
                    <td>{p.supplier?.legalName ?? '—'}</td>
                    <td>{formatBRL(p.amount)}</td>
                    <td>
                      <span
                        className={
                          'badge ' +
                          (p.status === 'PAID' ? 'badge-success' : p.status === 'OVERDUE' ? 'badge-danger' : 'badge-warn')
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
                    <td>{r.description}</td>
                    <td>{r.customer?.name ?? '—'}</td>
                    <td>{formatBRL(r.amount)}</td>
                    <td>
                      <span className={'badge ' + (r.status === 'PAID' ? 'badge-success' : 'badge-warn')}>{r.status}</span>
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

      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nova conta a pagar</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="field">
              <label htmlFor="fp-desc">Descrição *</label>
              <input id="fp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="fp-sup">Fornecedor</label>
              <select id="fp-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— Não informado —</option>
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.legalName}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="fp-amt">Valor *</label>
                <input id="fp-amt" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="fp-due">Vencimento *</label>
                <input id="fp-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!desc.trim() || !amount || createPayable.isPending}
                onClick={() => createPayable.mutate()}
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
