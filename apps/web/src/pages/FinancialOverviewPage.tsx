import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BalanceMovementModal } from '../components/BalanceMovementModal';
import { BalancePrintModal } from '../components/BalancePrintModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import { ledgerDirectionLabel, ledgerKindLabel } from '../lib/financial-overview-ledger-labels';

type LedgerRow = {
  occurredAt: string;
  kind: string;
  direction: 'IN' | 'OUT' | 'INFO';
  amount: string;
  title: string;
  detail: string | null;
  methodLabel: string | null;
  referentialAccountLabel?: string | null;
};

type Summary = {
  period: { from: string; to: string; label?: string; isCustomRange?: boolean };
  ledger: LedgerRow[];
  cash: {
    periodInflows: number;
    periodOutflows: number;
  };
};

function monthRangeDefaults(): { from: string; to: string } {
  const n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth(), 1);
  const end = new Date(n.getFullYear(), n.getMonth() + 1, 0);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export function FinancialOverviewPage() {
  const [includeOpen, setIncludeOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printInitial, setPrintInitial] = useState(() => monthRangeDefaults());

  const printCostCenters = useQuery({
    queryKey: ['financial-overview', 'cost-centers', 'all'],
    queryFn: () =>
      api<Array<{ id: string; code: string; description: string }>>('/financial-overview/cost-centers'),
    staleTime: 60_000,
    enabled: printOpen,
  });

  const summary = useQuery({
    queryKey: ['financial-overview', 'summary', 'acumulado'],
    queryFn: () => api<Summary>('/financial-overview/summary'),
  });

  const data = summary.data;

  function openPrintModal() {
    setPrintInitial(monthRangeDefaults());
    setPrintOpen(true);
  }

  const movimentacoesFluxo = useMemo(() => {
    const ledger = data?.ledger ?? [];
    return ledger.filter((row) => row.direction !== 'INFO');
  }, [data?.ledger]);

  return (
    <div className="page print-area">
      <ReportPrintSticker documentTitle="Balanço financeiro" />

      <h1 className="page-title">Balanço financeiro</h1>
      <p className="page-desc">
        Movimentações com efeito de entrada ou saída no período (inclui caixa, vendas no PDV e
        pagamentos/recebimentos no financeiro). Títulos apenas registrados aparecem em{' '}
        <Link to="/balanco/relatorios">Relatórios por período</Link> (diário completo).
      </p>

      <div className="toolbar no-print" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-primary" onClick={() => setIncludeOpen(true)}>
          Incluir
        </button>
        <button type="button" className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={openPrintModal}>
          Impressões…
        </button>
      </div>

      {summary.isError && (
        <div className="alert alert-error">{(summary.error as Error).message}</div>
      )}

      {summary.isLoading && <p>Carregando…</p>}

      {data && (
        <>
          <p style={{ marginTop: '1rem', fontSize: '0.92rem', color: 'var(--color-text-muted)' }}>
            <strong>{data.period.label ?? 'Período acumulado'}</strong>
            {' · '}
            {new Date(data.period.from).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}{' '}
            até{' '}
            {new Date(data.period.to).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>

          <div
            className="dash-hero"
            style={{
              marginTop: '0.75rem',
              gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
            }}
          >
            <article className="dash-hero-card">
              <span className="dash-hero-label">Total entradas (período)</span>
              <strong className="dash-hero-value" style={{ color: '#15803d' }}>
                {formatBRL(data.cash.periodInflows)}
              </strong>
            </article>
            <article className="dash-hero-card">
              <span className="dash-hero-label">Total saídas (período)</span>
              <strong className="dash-hero-value" style={{ color: '#b91c1c' }}>
                {formatBRL(data.cash.periodOutflows)}
              </strong>
            </article>
            <article className="dash-hero-card">
              <span className="dash-hero-label">Líquido (entradas − saídas)</span>
              <strong className="dash-hero-value">
                {formatBRL(data.cash.periodInflows - data.cash.periodOutflows)}
              </strong>
            </article>
          </div>

          <section style={{ marginTop: '1rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Movimentações</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Natureza</th>
                    <th>Origem</th>
                    <th className="num">Valor</th>
                    <th>Forma</th>
                    <th>Centro de custo</th>
                    <th>Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {movimentacoesFluxo.map((row, idx) => (
                    <tr key={`${row.occurredAt}-${row.kind}-${idx}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {new Date(row.occurredAt).toLocaleString('pt-BR')}
                      </td>
                      <td>{ledgerDirectionLabel(row.direction)}</td>
                      <td>{ledgerKindLabel(row.kind)}</td>
                      <td className="num">
                        {row.direction === 'OUT' ? '−' : ''}
                        {formatBRL(row.amount)}
                      </td>
                      <td>{row.methodLabel ?? '—'}</td>
                      <td style={{ fontSize: '0.8rem', maxWidth: 200 }}>
                        {row.referentialAccountLabel ?? '—'}
                      </td>
                      <td style={{ maxWidth: 320, fontSize: '0.85rem' }}>
                        <strong>{row.title}</strong>
                        {row.detail ? <div style={{ opacity: 0.9 }}>{row.detail}</div> : null}
                      </td>
                    </tr>
                  ))}
                  {!movimentacoesFluxo.length && (
                    <tr>
                      <td colSpan={7} className="empty">
                        Nenhuma movimentação no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <BalanceMovementModal open={includeOpen} onClose={() => setIncludeOpen(false)} />

      <BalancePrintModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        initialFrom={printInitial.from}
        initialTo={printInitial.to}
        initialCostCenterId=""
        costCenters={printCostCenters.data ?? []}
      />
    </div>
  );
}
