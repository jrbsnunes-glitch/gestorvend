import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BalancePrintModal } from '../components/BalancePrintModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import { ledgerDirectionLabel, ledgerKindLabel } from '../lib/financial-overview-ledger-labels';

/** Tipagem alinhada ao GET /financial-overview/summary (período explícito). */
type Summary = {
  period: { from: string; to: string; label?: string; isCustomRange?: boolean };
  notes: string[];
  costCenter: { id: string; code: string; description: string } | null;
  filteredCashFlow: { inflow: number; outflow: number; net: number } | null;
  storePosition: {
    cashLikeClosing: number;
    payablesOpen: number;
    receivablesOpen: number;
    approximatePosition: number;
  };
  ledger: Array<{
    occurredAt: string;
    kind: string;
    direction: 'IN' | 'OUT' | 'INFO';
    amount: string;
    title: string;
    detail: string | null;
    methodLabel: string | null;
    referentialAccountId?: string | null;
    referentialAccountCode?: string | null;
    referentialAccountLabel?: string | null;
  }>;
  cash: {
    openingBalanceInferred: number;
    periodInflows: number;
    periodOutflows: number;
    closingBalanceInferred: number;
    openingByMethod: Array<{ key: string; inflow: number; outflow: number; net: number }>;
    periodByMethod: Array<{ key: string; inflow: number; outflow: number; net: number }>;
    periodByReasonBucket: Array<{ key: string; inflow: number; outflow: number; net: number }>;
    movements: Array<{
      id: string;
      type: string;
      amount: string;
      method: string | null;
      methodLabel: string;
      reason: string | null;
      reasonBucket: string;
      referentialAccountId?: string | null;
      referentialAccountCode?: string | null;
      referentialAccountLabel?: string | null;
      createdAt: string;
      sessionControl: number;
      operatorName: string | null;
    }>;
  };
  sales: { count: number; revenueTotal: number };
  payables: {
    newTitlesCount: number;
    newTitlesAmount: number;
    settledFullyInPeriodCount: number;
    settledFullyInPeriodAmount: number;
    settledOffCashInPeriodAmount: number;
    openBalanceAmount: number;
    openTitlesCount: number;
  };
  receivables: {
    newTitlesCount: number;
    newTitlesAmount: number;
    settledFullyInPeriodCount: number;
    settledFullyInPeriodAmount: number;
    settledOffCashInPeriodAmount: number;
    openBalanceAmount: number;
    openTitlesCount: number;
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

export function FinancialOverviewReportsPage() {
  const [searchParams] = useSearchParams();
  const def = useMemo(() => monthRangeDefaults(), []);
  const qpFrom = searchParams.get('from');
  const qpTo = searchParams.get('to');
  const initialFrom =
    qpFrom && /^\d{4}-\d{2}-\d{2}$/.test(qpFrom) ? qpFrom : def.from;
  const initialTo = qpTo && /^\d{4}-\d{2}-\d{2}$/.test(qpTo) ? qpTo : def.to;

  const qpCostCenter = searchParams.get('costCenterId');
  const initialCc = qpCostCenter ?? '';

  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [costCenterId, setCostCenterId] = useState(initialCc);
  const [printModalOpen, setPrintModalOpen] = useState(false);

  const costCenters = useQuery({
    queryKey: ['financial-overview', 'cost-centers', 'all'],
    queryFn: () =>
      api<Array<{ id: string; code: string; description: string }>>(
        '/financial-overview/cost-centers',
      ),
    staleTime: 60_000,
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (costCenterId.trim()) p.set('costCenterId', costCenterId.trim());
    return p.toString();
  }, [from, to, costCenterId]);

  const summary = useQuery({
    queryKey: ['financial-overview', 'summary-relatorio', qs],
    queryFn: () => api<Summary>(`/financial-overview/summary?${qs}`),
  });

  const data = summary.data;

  function exportMovementsCsv() {
    if (!data?.cash.movements.length) return;
    const header = [
      'data',
      'tipo',
      'valor',
      'forma',
      'agrupador',
      'centro_custo',
      'motivo',
      'caixa',
      'operador',
    ];
    const lines = data.cash.movements.map((m) =>
      [
        m.createdAt,
        m.type,
        m.amount,
        m.methodLabel,
        m.reasonBucket,
        m.referentialAccountLabel ?? '',
        (m.reason ?? '').replaceAll('"', '""'),
        String(m.sessionControl),
        m.operatorName ?? '',
      ]
        .map((c) => `"${String(c)}"`)
        .join(';'),
    );
    const blob = new Blob([header.join(';') + '\n' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `balanco-relatorio-movimentos-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportLedgerCsv() {
    if (!data?.ledger.length) return;
    const header = ['data', 'tipo', 'natureza', 'valor', 'forma', 'centro_custo', 'titulo', 'detalhe'];
    const lines = data.ledger.map((row) =>
      [
        row.occurredAt,
        ledgerKindLabel(row.kind),
        ledgerDirectionLabel(row.direction),
        row.amount,
        row.methodLabel ?? '',
        row.referentialAccountLabel ?? '',
        row.title,
        (row.detail ?? '').replaceAll('"', '""'),
      ]
        .map((c) => `"${String(c)}"`)
        .join(';'),
    );
    const blob = new Blob([header.join(';') + '\n' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `balanco-diario-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="page print-area">
      <ReportPrintSticker documentTitle="Balanço — relatórios por período" />

      <h1 className="page-title">Balanço — relatórios por período</h1>
      <p className="page-desc">
        Escolha o intervalo para gerar impressão e exportação. A visão resumida em acumulado continua em{' '}
        <Link to="/balanco">Balanço financeiro</Link>.
      </p>

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bal-rep-from">De</label>
          <input
            id="bal-rep-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bal-rep-to">Até</label>
          <input id="bal-rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: 300 }}>
          <label htmlFor="bal-rep-cc">Centro de custo (filtro do relatório)</label>
          <select
            id="bal-rep-cc"
            value={costCenterId}
            onChange={(e) => setCostCenterId(e.target.value)}
          >
            <option value="">Todos</option>
            {(costCenters.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.description}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => summary.refetch()}>
          Atualizar
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setPrintModalOpen(true)}>
          Impressões…
        </button>
        <Link to="/balanco" className="btn btn-secondary">
          Voltar ao acumulado
        </Link>
        <Link to="/balanco/plano-contas" className="btn btn-secondary">
          Plano de contas (referencial)
        </Link>
      </div>

      {summary.isError && (
        <div className="alert alert-error">{(summary.error as Error).message}</div>
      )}

      {summary.isLoading && <p>Carregando…</p>}

      {data && (
        <>
          <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
            {data.period.label ?? 'Período selecionado'} —{' '}
            {new Date(data.period.from).toLocaleDateString('pt-BR')} a{' '}
            {new Date(data.period.to).toLocaleDateString('pt-BR')}
            {data.costCenter
              ? ` · Centro: ${data.costCenter.code} — ${data.costCenter.description}`
              : ''}
          </p>

          {data.filteredCashFlow && data.costCenter && (
            <div
              className="card"
              style={{
                marginTop: '0.75rem',
                padding: '0.85rem 1rem',
                background: 'var(--color-surface-elevated)',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', rowGap: '0.65rem' }}>
                <strong style={{ fontSize: '0.92rem' }}>
                  Fluxo filtrado (conta do centro e subcontas no diário)
                </strong>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flexShrink: 0 }}
                  onClick={exportLedgerCsv}
                  disabled={!data.ledger.length}
                >
                  Exportar diário CSV (centro)
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '1.5rem',
                  flexWrap: 'wrap',
                  marginTop: '0.5rem',
                  fontSize: '0.9rem',
                }}
              >
                <span>
                  Entradas: <strong>{formatBRL(data.filteredCashFlow.inflow)}</strong>
                </span>
                <span>
                  Saídas: <strong>{formatBRL(data.filteredCashFlow.outflow)}</strong>
                </span>
                <span>
                  Líquido: <strong>{formatBRL(data.filteredCashFlow.net)}</strong>
                </span>
              </div>
              <p style={{ margin: '0.75rem 0 0.5rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                Lançamentos que compõem o total acima (linhas IN/OUT do diário para este centro; linhas INFO
                não entram nos totais de entradas/saídas).
              </p>
              <div className="table-wrap" style={{ marginTop: '0.35rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Natureza</th>
                      <th>Tipo</th>
                      <th className="num">Valor</th>
                      <th>Forma</th>
                      <th>Centro no plano</th>
                      <th>Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.map((row, idx) => (
                      <tr key={`cc-ledger-${row.occurredAt}-${row.kind}-${idx}`}>
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
                        <td style={{ fontSize: '0.82rem', maxWidth: 220 }}>
                          {row.referentialAccountLabel ?? '—'}
                        </td>
                        <td style={{ maxWidth: 320, fontSize: '0.85rem' }}>
                          <strong>{row.title}</strong>
                          {row.detail ? <div style={{ opacity: 0.9 }}>{row.detail}</div> : null}
                        </td>
                      </tr>
                    ))}
                    {!data.ledger.length && (
                      <tr>
                        <td colSpan={7} className="empty">
                          Nenhum lançamento no período classificado neste centro.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.costCenter ? (
            <details
              className="card"
              style={{
                marginTop: '0.5rem',
                padding: '0.65rem 0.85rem',
                background: 'var(--color-surface)',
              }}
            >
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem' }}>
                Totais globais de caixa (toda a loja) — clique para expandir
              </summary>
              <p
                style={{
                  margin: '0.5rem 0 0.75rem',
                  fontSize: '0.82rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                Com centro de custo selecionado, os números abaixo não refletem só esse centro; use o
                cartão “fluxo filtrado” (totais e lançamentos do diário daquele centro).
              </p>
              <div
                className="dash-hero"
                style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}
              >
                <article className="dash-hero-card">
                  <span className="dash-hero-label">Saldo inicial caixa (inferido)</span>
                  <strong className="dash-hero-value">{formatBRL(data.cash.openingBalanceInferred)}</strong>
                </article>
                <article className="dash-hero-card">
                  <span className="dash-hero-label">Entradas no período</span>
                  <strong className="dash-hero-value" style={{ color: '#15803d' }}>
                    {formatBRL(data.cash.periodInflows)}
                  </strong>
                </article>
                <article className="dash-hero-card">
                  <span className="dash-hero-label">Saídas no período</span>
                  <strong className="dash-hero-value" style={{ color: '#b91c1c' }}>
                    {formatBRL(data.cash.periodOutflows)}
                  </strong>
                </article>
                <article className="dash-hero-card">
                  <span className="dash-hero-label">Saldo final caixa (inferido)</span>
                  <strong className="dash-hero-value">{formatBRL(data.cash.closingBalanceInferred)}</strong>
                </article>
              </div>
            </details>
          ) : (
            <div
              className="dash-hero"
              style={{ marginTop: '0.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}
            >
              <article className="dash-hero-card">
                <span className="dash-hero-label">Saldo inicial caixa (inferido)</span>
                <strong className="dash-hero-value">{formatBRL(data.cash.openingBalanceInferred)}</strong>
              </article>
              <article className="dash-hero-card">
                <span className="dash-hero-label">Entradas no período</span>
                <strong className="dash-hero-value" style={{ color: '#15803d' }}>
                  {formatBRL(data.cash.periodInflows)}
                </strong>
              </article>
              <article className="dash-hero-card">
                <span className="dash-hero-label">Saídas no período</span>
                <strong className="dash-hero-value" style={{ color: '#b91c1c' }}>
                  {formatBRL(data.cash.periodOutflows)}
                </strong>
              </article>
              <article className="dash-hero-card">
                <span className="dash-hero-label">Saldo final caixa (inferido)</span>
                <strong className="dash-hero-value">{formatBRL(data.cash.closingBalanceInferred)}</strong>
              </article>
            </div>
          )}

          <div
            className="dash-hero"
            style={{ marginTop: '0.75rem', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}
          >
            <article className="dash-hero-card">
              <span className="dash-hero-label">Posição aprox. da loja</span>
              <strong className="dash-hero-value">{formatBRL(data.storePosition.approximatePosition)}</strong>
            </article>
            <article className="dash-hero-card">
              <span className="dash-hero-label">A receber em aberto</span>
              <strong className="dash-hero-value">{formatBRL(data.storePosition.receivablesOpen)}</strong>
            </article>
            <article className="dash-hero-card">
              <span className="dash-hero-label">A pagar em aberto</span>
              <strong className="dash-hero-value">{formatBRL(data.storePosition.payablesOpen)}</strong>
            </article>
          </div>

          {!data.costCenter ? (
            <section className="card" style={{ marginTop: '1.25rem', padding: '1rem' }}>
              <div className="toolbar" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Diário do período</h2>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={exportLedgerCsv}
                  disabled={!data.ledger.length}
                >
                  Exportar diário CSV
                </button>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Natureza</th>
                      <th>Tipo</th>
                      <th className="num">Valor</th>
                      <th>Forma</th>
                      <th>Centro de custo</th>
                      <th>Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.map((row, idx) => (
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
                        <td style={{ fontSize: '0.82rem', maxWidth: 220 }}>
                          {row.referentialAccountLabel ?? '—'}
                        </td>
                        <td style={{ maxWidth: 320, fontSize: '0.85rem' }}>
                          <strong>{row.title}</strong>
                          {row.detail ? <div style={{ opacity: 0.9 }}>{row.detail}</div> : null}
                        </td>
                      </tr>
                    ))}
                    {!data.ledger.length && (
                      <tr>
                        <td colSpan={7} className="empty">
                          Nenhum lançamento no período.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="card" style={{ marginTop: '1.25rem', padding: '1rem' }}>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.6 }}>
              {data.costCenter && data.filteredCashFlow ? (
                <>
                  <li>
                    No centro — entradas (diário filtrado):{' '}
                    <strong>{formatBRL(data.filteredCashFlow.inflow)}</strong>
                  </li>
                  <li>
                    No centro — saídas (diário filtrado):{' '}
                    <strong>{formatBRL(data.filteredCashFlow.outflow)}</strong>
                  </li>
                  <li>
                    No centro — líquido: <strong>{formatBRL(data.filteredCashFlow.net)}</strong>
                  </li>
                  <li style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                    Abaixo: indicadores de toda a loja no período (não restritos ao centro).
                  </li>
                </>
              ) : null}
              <li>
                Total entrou (caixa{data.costCenter ? ', loja inteira' : ''}):{' '}
                <strong>{formatBRL(data.cash.periodInflows)}</strong>
              </li>
              <li>
                Total saiu (caixa{data.costCenter ? ', loja inteira' : ''}):{' '}
                <strong>{formatBRL(data.cash.periodOutflows)}</strong>
              </li>
              <li>
                Saldo caixa fechamento (inferido):{' '}
                <strong>{formatBRL(data.cash.closingBalanceInferred)}</strong>
              </li>
              <li>
                Faturamento vendas (concluídas): <strong>{formatBRL(data.sales.revenueTotal)}</strong> (
                {data.sales.count} venda(s))
              </li>
              <li>
                Contas a pagar — liquidado total no período:{' '}
                <strong>{formatBRL(data.payables.settledFullyInPeriodAmount)}</strong> (
                {data.payables.settledFullyInPeriodCount} título(s)); fora do caixa:{' '}
                <strong>{formatBRL(data.payables.settledOffCashInPeriodAmount)}</strong>
              </li>
              <li>
                Contas a receber — liquidado total no período:{' '}
                <strong>{formatBRL(data.receivables.settledFullyInPeriodAmount)}</strong> (
                {data.receivables.settledFullyInPeriodCount} título(s)); fora do caixa:{' '}
                <strong>{formatBRL(data.receivables.settledOffCashInPeriodAmount)}</strong>
              </li>
            </ul>
            <p style={{ marginBottom: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              {data.notes.join(' ')}
            </p>
          </section>

          <div className="form-row" style={{ marginTop: '1.25rem', gap: '1rem', alignItems: 'stretch' }}>
            <section className="card" style={{ flex: 1, padding: '1rem', minWidth: 280 }}>
              <h3 style={{ marginTop: 0 }}>Títulos a pagar</h3>
              <p>
                Novos no período: {formatBRL(data.payables.newTitlesAmount)} ({data.payables.newTitlesCount})
              </p>
              <p>
                Saldo em aberto (agora): {formatBRL(data.payables.openBalanceAmount)} (
                {data.payables.openTitlesCount} título(s))
              </p>
            </section>
            <section className="card" style={{ flex: 1, padding: '1rem', minWidth: 280 }}>
              <h3 style={{ marginTop: 0 }}>Títulos a receber</h3>
              <p>
                Novos no período: {formatBRL(data.receivables.newTitlesAmount)} (
                {data.receivables.newTitlesCount})
              </p>
              <p>
                Saldo em aberto (agora): {formatBRL(data.receivables.openBalanceAmount)} (
                {data.receivables.openTitlesCount} título(s))
              </p>
            </section>
          </div>

          {!data.costCenter ? (
            <>
              <section style={{ marginTop: '1.25rem' }}>
                <h2 style={{ fontSize: '1.05rem' }}>Caixa no período — por forma de pagamento</h2>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Forma</th>
                        <th className="num">Entradas</th>
                        <th className="num">Saídas</th>
                        <th className="num">Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.cash.periodByMethod.map((row) => (
                        <tr key={row.key}>
                          <td>{row.key}</td>
                          <td className="num">{formatBRL(row.inflow)}</td>
                          <td className="num">{formatBRL(row.outflow)}</td>
                          <td className="num">{formatBRL(row.net)}</td>
                        </tr>
                      ))}
                      {!data.cash.periodByMethod.length && (
                        <tr>
                          <td colSpan={4} className="empty">
                            Sem movimentos no período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section style={{ marginTop: '1.25rem' }}>
                <h2 style={{ fontSize: '1.05rem' }}>Caixa no período — por origem (motivo)</h2>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Origem</th>
                        <th className="num">Entradas</th>
                        <th className="num">Saídas</th>
                        <th className="num">Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.cash.periodByReasonBucket.map((row) => (
                        <tr key={row.key}>
                          <td>{row.key}</td>
                          <td className="num">{formatBRL(row.inflow)}</td>
                          <td className="num">{formatBRL(row.outflow)}</td>
                          <td className="num">{formatBRL(row.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <p
              style={{
                marginTop: '1.25rem',
                fontSize: '0.88rem',
                color: 'var(--color-text-muted)',
              }}
            >
              As tabelas “por forma de pagamento” e “por origem” somam o caixa de toda a loja. Com filtro
              de centro, use o diário e os movimentos de caixa abaixo.
            </p>
          )}

          <section style={{ marginTop: '1.25rem' }}>
            <div className="toolbar">
              <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Movimentos de caixa (período)</h2>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={exportMovementsCsv}
                disabled={!data.cash.movements.length}
              >
                Exportar CSV
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th className="num">Valor</th>
                    <th>Forma</th>
                    <th>Origem</th>
                    <th>Centro de custo</th>
                    <th>Caixa</th>
                    <th>Operador</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cash.movements.map((m) => (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {new Date(m.createdAt).toLocaleString('pt-BR')}
                      </td>
                      <td>{m.type === 'IN' ? 'Entrada' : 'Saída'}</td>
                      <td className="num">{formatBRL(m.amount)}</td>
                      <td>{m.methodLabel}</td>
                      <td>{m.reasonBucket}</td>
                      <td style={{ fontSize: '0.8rem', maxWidth: 200 }}>
                        {m.referentialAccountLabel ?? '—'}
                      </td>
                      <td className="num">#{m.sessionControl}</td>
                      <td>{m.operatorName ?? '—'}</td>
                      <td style={{ maxWidth: 280, fontSize: '0.82rem' }}>{m.reason ?? '—'}</td>
                    </tr>
                  ))}
                  {!data.cash.movements.length && (
                    <tr>
                      <td colSpan={9} className="empty">
                        Nenhum movimento.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <BalancePrintModal
        open={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        initialFrom={from}
        initialTo={to}
        initialCostCenterId={costCenterId}
        costCenters={costCenters.data ?? []}
      />
    </div>
  );
}
