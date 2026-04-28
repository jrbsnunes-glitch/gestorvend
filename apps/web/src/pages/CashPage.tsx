import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';

type Session = {
  id: string;
  status: string;
  openingBalance: string;
  closingBalance: string | null;
  openedAt: string;
  closedAt: string | null;
  movements: Array<{ id: string; type: string; amount: string; reason: string | null; createdAt: string }>;
};

const MOV_TYPES = ['IN', 'OUT'] as const;

export function CashPage() {
  const qc = useQueryClient();
  const [openBalanced, setOpenBalanced] = useState('0');
  const [closeBalanced, setCloseBalanced] = useState('0');
  const [movType, setMovType] = useState<(typeof MOV_TYPES)[number]>('OUT');
  const [movAmount, setMovAmount] = useState('');
  const [movReason, setMovReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const session = useQuery({
    queryKey: ['cash-session'],
    queryFn: () => api<Session | null>('/cash/session'),
  });

  const openCash = useMutation({
    mutationFn: () =>
      api('/cash/open', {
        method: 'POST',
        json: { openingBalance: parseFloat(openBalanced.replace(',', '.')) || 0 },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-session'] });
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const closeCash = useMutation({
    mutationFn: () =>
      api('/cash/close', {
        method: 'POST',
        json: { closingBalance: parseFloat(closeBalanced.replace(',', '.')) || 0 },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-session'] });
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const movement = useMutation({
    mutationFn: () =>
      api('/cash/movement', {
        method: 'POST',
        json: {
          type: movType,
          amount: parseFloat(movAmount.replace(',', '.')) || 0,
          reason: movReason || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-session'] });
      setMovAmount('');
      setMovReason('');
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const s = session.data;

  return (
    <div className="page">
      <h1 className="page-title">Caixa</h1>
      <p className="page-desc">Abertura, fechamento, sangrias e suprimentos do operador logado.</p>

      {err && <div className="alert alert-error">{err}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">Situação</div>
          <div className="value" style={{ fontSize: '1.05rem' }}>
            {session.isLoading ? '…' : s ? 'Caixa aberto' : 'Caixa fechado'}
          </div>
        </div>
        {s && (
          <>
            <div className="stat-card">
              <div className="label">Saldo inicial</div>
              <div className="value" style={{ fontSize: '1.1rem' }}>
                {formatBRL(s.openingBalance)}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Aberto em</div>
              <div className="value" style={{ fontSize: '0.95rem' }}>
                {new Date(s.openedAt).toLocaleString('pt-BR')}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card">
        {!s ? (
          <>
            <h2 className="page-title" style={{ fontSize: '1.05rem' }}>
              Abrir caixa
            </h2>
            <div className="form-row">
              <div className="field">
                <label htmlFor="open-b">Saldo inicial (R$)</label>
                <input id="open-b" value={openBalanced} onChange={(e) => setOpenBalanced(e.target.value)} type="number" step="0.01" />
              </div>
            </div>
            <button type="button" className="btn btn-primary" disabled={openCash.isPending} onClick={() => openCash.mutate()}>
              Abrir
            </button>
          </>
        ) : (
          <>
            <h2 className="page-title" style={{ fontSize: '1.05rem' }}>
              Fechar caixa
            </h2>
            <div className="form-row">
              <div className="field">
                <label htmlFor="close-b">Saldo contado (R$)</label>
                <input id="close-b" value={closeBalanced} onChange={(e) => setCloseBalanced(e.target.value)} type="number" step="0.01" />
              </div>
            </div>
            <button type="button" className="btn btn-primary" disabled={closeCash.isPending} onClick={() => closeCash.mutate()}>
              Fechar
            </button>
          </>
        )}
      </div>

      {s && (
        <div className="card">
          <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>
            Movimento (sangria / suprimento)
          </h2>
          <div className="form-row">
            <div className="field">
              <label>Tipo</label>
              <select value={movType} onChange={(e) => setMovType(e.target.value as typeof movType)}>
                <option value="OUT">Saída (sangria)</option>
                <option value="IN">Entrada (suprimento)</option>
              </select>
            </div>
            <div className="field">
              <label>Valor (R$)</label>
              <input value={movAmount} onChange={(e) => setMovAmount(e.target.value)} type="number" step="0.01" />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>Motivo</label>
              <input value={movReason} onChange={(e) => setMovReason(e.target.value)} />
            </div>
          </div>
          <button type="button" className="btn btn-secondary" disabled={movement.isPending} onClick={() => movement.mutate()}>
            Registrar
          </button>

          <h3 style={{ fontSize: '0.95rem', margin: '1.5rem 0 0.75rem' }}>Histórico recente</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {!s.movements?.length && (
                  <tr>
                    <td colSpan={4} className="empty">
                      Sem lançamentos.
                    </td>
                  </tr>
                )}
                {s.movements?.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontSize: '0.85rem' }}>{new Date(m.createdAt).toLocaleString('pt-BR')}</td>
                    <td>
                      <span className="badge badge-muted">{m.type}</span>
                    </td>
                    <td>{formatBRL(m.amount)}</td>
                    <td>{m.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
