import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';
import './cash-print.css';

type DreLine = {
  id: string;
  label: string;
  amount: number | null;
  level: number;
  kind: 'REVENUE' | 'COST' | 'EXPENSE' | 'RESULT' | 'INFO';
};

type ProfitabilityReport = {
  title: string;
  period: { from: string; to: string };
  methodology: string;
  dre: DreLine[];
  indicators: {
    grossMarginPct: number | null;
    operatingMarginPct: number | null;
    fiscalCoveragePct: number | null;
    cashSalesSharePct: number | null;
    avgTicket: number | null;
  };
  sales: {
    count: number;
    grossRevenue: number;
    cogs: number;
    grossProfit: number;
    paymentsExcludingCredit: number;
  };
  fiscal: {
    nfceAuthorized: { count: number; total: number };
    nfcePending: { count: number; total: number };
    nfceRejectedOrError: { count: number; total: number };
    noFiscalDocument: { count: number; total: number };
    coveragePct: number | null;
  };
  cashRegisters: {
    sessionsClosedInPeriod: number;
    totalSalesInSessions: number;
    salesByMethod: Array<{ method: string; label: string; total: number }>;
    sessionExpenses: number;
  };
  expenses: {
    operatingTotal: number;
    fromCashExpenseMovements: number;
    fromPayableSettlements: number;
  };
  liquidity: {
    payablesOpen: number;
    receivablesOpen: number;
  };
  notes: string[];
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

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} %`;
}

function formatDreValue(line: DreLine): string {
  if (line.amount == null) return '—';
  if (line.id === 'gross-margin' || line.id === 'operating-margin') {
    return formatPct(line.amount);
  }
  return formatBRL(line.amount);
}

export function ProfitabilityReportPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const def = useMemo(() => monthRangeDefaults(), []);
  const [from, setFrom] = useState(searchParams.get('from') ?? def.from);
  const [to, setTo] = useState(searchParams.get('to') ?? def.to);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  useEffect(() => {
    setFrom(searchParams.get('from') ?? def.from);
    setTo(searchParams.get('to') ?? def.to);
  }, [searchParams, def.from, def.to]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  }, [from, to]);

  const enabled = Boolean(from && to);

  const report = useQuery({
    queryKey: ['financial-overview', 'profitability', qs],
    queryFn: () => api<ProfitabilityReport>(`/financial-overview/profitability?${qs}`),
    enabled,
  });

  const data = report.data;

  function applyFilters() {
    setApplyErr(null);
    if (!from.trim() || !to.trim()) {
      setApplyErr('Informe o período (data inicial e final).');
      return;
    }
    setSearchParams(new URLSearchParams({ from, to }), { replace: true });
  }

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/balanco/relatorios')}>
          ← Relatórios do balanço
        </button>
        <Link to="/balanco" className="btn btn-ghost">
          Balanço
        </Link>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir ou salvar PDF
        </button>
      </div>

      <div
        className="no-print pm-move-filters"
        style={{
          marginBottom: '0.65rem',
          padding: '0.45rem 0.65rem',
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: 8,
        }}
      >
        <div className="pm-move-filters__title">Rentabilidade — período</div>
        {applyErr && <div className="alert alert-error pm-move-filters__alert">{applyErr}</div>}
        <div className="pm-move-filters__row">
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="prof-from">Data inicial</label>
            <input id="prof-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="prof-to">Data final</label>
            <input id="prof-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" onClick={applyFilters}>
            Atualizar relatório
          </button>
        </div>
      </div>

      <StandardReportHeader
        documentTitle="Rentabilidade — saúde financeira"
        documentExtras={
          data ? (
            <>
              <p className="print-sub" style={{ marginBottom: '0.35rem' }}>
                Período: <strong>{formatDate(data.period.from)}</strong> a{' '}
                <strong>{formatDate(data.period.to)}</strong>
              </p>
              <p className="print-sub" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
                {data.methodology}
              </p>
            </>
          ) : enabled ? (
            <p className="print-sub">Carregando…</p>
          ) : (
            <p className="print-sub">Informe o período e clique em Atualizar relatório.</p>
          )
        }
      />

      {report.isError && (
        <div className="alert alert-error no-print">{(report.error as Error).message}</div>
      )}

      {data && (
        <>
          <div
            className="dash-hero no-print"
            style={{
              marginBottom: '1rem',
              gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))',
            }}
          >
            <article className="dash-hero-card">
              <span className="dash-hero-label">Margem bruta</span>
              <strong className="dash-hero-value">{formatPct(data.indicators.grossMarginPct)}</strong>
            </article>
            <article className="dash-hero-card">
              <span className="dash-hero-label">Margem operacional</span>
              <strong className="dash-hero-value">{formatPct(data.indicators.operatingMarginPct)}</strong>
            </article>
            <article className="dash-hero-card">
              <span className="dash-hero-label">Cobertura NFC-e</span>
              <strong className="dash-hero-value">{formatPct(data.indicators.fiscalCoveragePct)}</strong>
            </article>
            <article className="dash-hero-card">
              <span className="dash-hero-label">Ticket médio</span>
              <strong className="dash-hero-value">
                {data.indicators.avgTicket != null ? formatBRL(data.indicators.avgTicket) : '—'}
              </strong>
            </article>
          </div>

          <section style={{ marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem' }}>
              Demonstração de resultados (gerencial)
            </h2>
            <div className="table-wrap">
              <table className="data-table print-table-compact">
                <thead>
                  <tr>
                    <th>Conta / indicador</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dre.map((line) => (
                    <tr
                      key={line.id}
                      style={{
                        fontWeight: line.kind === 'RESULT' ? 700 : line.level === 0 ? 600 : 400,
                        background:
                          line.kind === 'RESULT'
                            ? 'var(--color-surface-elevated)'
                            : undefined,
                      }}
                    >
                      <td style={{ paddingLeft: `${0.5 + line.level * 1.25}rem` }}>{line.label}</td>
                      <td className="num">{formatDreValue(line)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="bal-rep-dual-cards">
            <section className="card" style={{ padding: '1rem' }}>
              <h3 style={{ marginTop: 0 }}>Conformidade fiscal (NFC-e)</h3>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.55 }}>
                <li>
                  Autorizadas: <strong>{data.fiscal.nfceAuthorized.count}</strong> —{' '}
                  {formatBRL(data.fiscal.nfceAuthorized.total)}
                </li>
                <li>
                  Pendentes / fila: <strong>{data.fiscal.nfcePending.count}</strong> —{' '}
                  {formatBRL(data.fiscal.nfcePending.total)}
                </li>
                <li>
                  Rejeitadas / erro / canceladas:{' '}
                  <strong>{data.fiscal.nfceRejectedOrError.count}</strong> —{' '}
                  {formatBRL(data.fiscal.nfceRejectedOrError.total)}
                </li>
                <li>
                  Sem NFC-e: <strong>{data.fiscal.noFiscalDocument.count}</strong> —{' '}
                  {formatBRL(data.fiscal.noFiscalDocument.total)}
                </li>
              </ul>
              <p style={{ marginBottom: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                Cobertura fiscal = valor de vendas com NFC-e autorizada ÷ faturamento do período (
                {formatPct(data.fiscal.coveragePct)}).
              </p>
            </section>

            <section className="card" style={{ padding: '1rem' }}>
              <h3 style={{ marginTop: 0 }}>Caixas fechados no período</h3>
              <p>
                Sessões: <strong>{data.cashRegisters.sessionsClosedInPeriod}</strong>
              </p>
              <p>
                Vendas nas janelas de caixa:{' '}
                <strong>{formatBRL(data.cashRegisters.totalSalesInSessions)}</strong>
              </p>
              <p>
                Despesas registradas nas sessões:{' '}
                <strong>{formatBRL(data.cashRegisters.sessionExpenses)}</strong>
              </p>
              {data.cashRegisters.salesByMethod.length > 0 && (
                <>
                  <p style={{ marginBottom: '0.35rem', fontSize: '0.88rem' }}>Por forma de pagamento:</p>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.88rem' }}>
                    {data.cashRegisters.salesByMethod.map((row) => (
                      <li key={row.method}>
                        {row.label}: {formatBRL(row.total)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          <section className="card" style={{ marginTop: '1rem', padding: '1rem' }}>
            <h3 style={{ marginTop: 0 }}>Posição de curto prazo (referência)</h3>
            <p style={{ margin: '0.25rem 0' }}>
              A pagar em aberto: <strong>{formatBRL(data.liquidity.payablesOpen)}</strong>
            </p>
            <p style={{ margin: '0.25rem 0' }}>
              A receber em aberto: <strong>{formatBRL(data.liquidity.receivablesOpen)}</strong>
            </p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Recebimentos no PDV (exc. crediário):{' '}
              <strong>{formatBRL(data.sales.paymentsExcludingCredit)}</strong> ·{' '}
              {data.sales.count} venda(s) · Faturamento {formatBRL(data.sales.grossRevenue)}
            </p>
          </section>

          <section style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem' }}>Notas metodológicas</h3>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', lineHeight: 1.55 }}>
              {data.notes.map((n) => (
                <li key={n.slice(0, 48)}>{n}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
