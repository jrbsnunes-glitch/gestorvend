import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';
import { ledgerDirectionLabel, ledgerKindLabel } from '../lib/financial-overview-ledger-labels';

type PrintSummary = {
  period: { from: string; to: string; label?: string };
  notes: string[];
  costCenter?: { id: string; code: string; description: string } | null;
  filteredCashFlow?: { inflow: number; outflow: number; net: number } | null;
  ledger: Array<{
    occurredAt: string;
    kind: string;
    direction: 'IN' | 'OUT' | 'INFO';
    amount: string;
    title: string;
    detail: string | null;
    methodLabel: string | null;
    referentialAccountLabel?: string | null;
  }>;
  cash: {
    openingBalanceInferred: number;
    periodInflows: number;
    periodOutflows: number;
    closingBalanceInferred: number;
    movements: Array<{
      id: string;
      type: string;
      amount: string;
      methodLabel: string;
      reason: string | null;
      reasonBucket: string;
      referentialAccountLabel?: string | null;
      createdAt: string;
      sessionControl: number;
      operatorName: string | null;
    }>;
  };
  sales: { count: number; revenueTotal: number };
  payables: {
    settledFullyInPeriodAmount: number;
    settledOffCashInPeriodAmount: number;
    openBalanceAmount: number;
  };
  receivables: {
    settledFullyInPeriodAmount: number;
    settledOffCashInPeriodAmount: number;
    openBalanceAmount: number;
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

export function FinancialOverviewPrintPage() {
  const [sp] = useSearchParams();
  const def = monthRangeDefaults();
  const from = sp.get('from') ?? def.from;
  const to = sp.get('to') ?? def.to;
  const costCenterId = sp.get('costCenterId');

  const showSummary = sp.get('summary') !== '0';
  const showNotes = sp.get('notes') !== '0';
  const showMovements = sp.get('movements') !== '0';
  const showLedger = sp.get('ledger') === '1';

  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (costCenterId?.trim()) qs.set('costCenterId', costCenterId.trim());

  const q = useQuery({
    queryKey: ['financial-overview', 'summary-print', qs.toString()],
    queryFn: () => api<PrintSummary>(`/financial-overview/summary?${qs.toString()}`),
  });

  const d = q.data;

  return (
    <div className="page print-area gv-finance-print-root">
      <StandardReportHeader
        documentTitle="Balanço financeiro — relatório"
        documentExtras={
          <span>
            Período: {formatDate(from)} — {formatDate(to)}
            {costCenterId?.trim()
              ? ` · Centro: ${
                  d?.costCenter
                    ? `${d.costCenter.code} — ${d.costCenter.description}`
                    : `#${costCenterId.slice(0, 8)}…`
                }`
              : ''}
          </span>
        }
      />

      <div className="no-print" style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
        <Link to="/balanco" className="btn btn-secondary">
          Voltar ao balanço
        </Link>
      </div>

      {q.isLoading && <p className="no-print">Carregando…</p>}
      {q.isError && (
        <div className="alert alert-error no-print">{(q.error as Error).message}</div>
      )}

      {d && (
        <>
          {showSummary ? (
            <section className="gv-finance-print-detail">
              <h2>Resumo</h2>
              {d.costCenter && d.filteredCashFlow ? (
                <>
                  <h3 style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>
                    Centro de custo: {d.costCenter.code} — {d.costCenter.description}
                  </h3>
                  <p style={{ fontSize: '0.88rem', marginTop: 0, marginBottom: '0.75rem' }}>
                    Valores abaixo referem-se às linhas IN/OUT do diário classificadas nesta conta ou em
                    subcontas (código do plano).
                  </p>
                  <dl className="gv-finance-dl">
                    <dt>Entradas (diário filtrado)</dt>
                    <dd>{formatBRL(d.filteredCashFlow.inflow)}</dd>
                    <dt>Saídas (diário filtrado)</dt>
                    <dd>{formatBRL(d.filteredCashFlow.outflow)}</dd>
                    <dt>Líquido (diário filtrado)</dt>
                    <dd>{formatBRL(d.filteredCashFlow.net)}</dd>
                  </dl>
                  <h3 style={{ fontSize: '1rem', marginTop: '1rem', marginBottom: '0.35rem' }}>
                    Lançamentos do diário (centro selecionado)
                  </h3>
                  <p style={{ fontSize: '0.82rem', marginTop: 0, marginBottom: '0.5rem' }}>
                    Linhas que compõem os totais acima (IN/OUT). Linhas INFO não entram nas entradas/saídas
                    filtradas.
                  </p>
                  <table
                    className="data-table gv-finance-print-table"
                    style={{ width: '100%', fontSize: '0.75rem', marginTop: '0.25rem' }}
                  >
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Natureza</th>
                        <th>Tipo</th>
                        <th className="num">Valor</th>
                        <th>Forma</th>
                        <th>Centro</th>
                        <th>Descrição</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.ledger.map((row, idx) => (
                        <tr key={`cc-print-${row.occurredAt}-${row.kind}-${idx}`}>
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
                          <td style={{ maxWidth: 100 }}>{row.referentialAccountLabel ?? '—'}</td>
                          <td style={{ maxWidth: 220 }}>
                            <strong>{row.title}</strong>
                            {row.detail ? <div style={{ opacity: 0.9 }}>{row.detail}</div> : null}
                          </td>
                        </tr>
                      ))}
                      {!d.ledger.length && (
                        <tr>
                          <td colSpan={7} className="empty">
                            Nenhum lançamento no período classificado neste centro.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <h3 style={{ fontSize: '1rem', marginTop: '1.25rem', marginBottom: '0.35rem' }}>
                    Indicadores gerais da loja (período)
                  </h3>
                  <p style={{ fontSize: '0.88rem', marginTop: 0, marginBottom: '0.75rem' }}>
                    Incluem toda a operação; não correspondem apenas ao centro acima.
                  </p>
                </>
              ) : null}
              <dl className="gv-finance-dl">
                <dt>Saldo inicial caixa (inferido)</dt>
                <dd>{formatBRL(d.cash.openingBalanceInferred)}</dd>
                <dt>Entradas no período (caixa, loja inteira)</dt>
                <dd>{formatBRL(d.cash.periodInflows)}</dd>
                <dt>Saídas no período (caixa, loja inteira)</dt>
                <dd>{formatBRL(d.cash.periodOutflows)}</dd>
                <dt>Saldo final caixa (inferido)</dt>
                <dd>{formatBRL(d.cash.closingBalanceInferred)}</dd>
                <dt>Faturamento (vendas concluídas)</dt>
                <dd>
                  {formatBRL(d.sales.revenueTotal)} — {d.sales.count} venda(s)
                </dd>
                <dt>Pago — títulos quitados no período (total)</dt>
                <dd>{formatBRL(d.payables.settledFullyInPeriodAmount)}</dd>
                <dt>Pago — fora do caixa no período</dt>
                <dd>{formatBRL(d.payables.settledOffCashInPeriodAmount)}</dd>
                <dt>Recebido — títulos quitados no período (total)</dt>
                <dd>{formatBRL(d.receivables.settledFullyInPeriodAmount)}</dd>
                <dt>Recebido — fora do caixa no período</dt>
                <dd>{formatBRL(d.receivables.settledOffCashInPeriodAmount)}</dd>
                <dt>Saldo em aberto — a pagar (posição atual)</dt>
                <dd>{formatBRL(d.payables.openBalanceAmount)}</dd>
                <dt>Saldo em aberto — a receber (posição atual)</dt>
                <dd>{formatBRL(d.receivables.openBalanceAmount)}</dd>
              </dl>
            </section>
          ) : null}

          {showNotes ? (
            <section className="gv-finance-print-detail" style={{ marginTop: '1rem' }}>
              <h3>Notas</h3>
              <ul style={{ marginTop: '0.5rem' }}>
                {d.notes.map((n) => (
                  <li key={n.slice(0, 40)}>{n}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {showMovements ? (
            <section className="gv-finance-print-detail" style={{ marginTop: '1rem' }}>
              <h2>Movimentos de caixa</h2>
              <table
                className="data-table gv-finance-print-table"
                style={{ width: '100%', fontSize: '0.78rem', marginTop: '0.5rem' }}
              >
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th className="num">Valor</th>
                    <th>Forma</th>
                    <th>Origem</th>
                    <th>Centro</th>
                    <th>Caixa</th>
                    <th>Operador</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {d.cash.movements.map((m) => (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {new Date(m.createdAt).toLocaleString('pt-BR')}
                      </td>
                      <td>{m.type === 'IN' ? 'Entrada' : 'Saída'}</td>
                      <td className="num">{formatBRL(m.amount)}</td>
                      <td>{m.methodLabel}</td>
                      <td>{m.reasonBucket}</td>
                      <td style={{ maxWidth: 120 }}>{m.referentialAccountLabel ?? '—'}</td>
                      <td className="num">#{m.sessionControl}</td>
                      <td>{m.operatorName ?? '—'}</td>
                      <td style={{ maxWidth: 200 }}>{m.reason ?? '—'}</td>
                    </tr>
                  ))}
                  {!d.cash.movements.length && (
                    <tr>
                      <td colSpan={9} className="empty">
                        Nenhum movimento no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          ) : null}

          {showLedger && !d.costCenter ? (
            <section className="gv-finance-print-detail" style={{ marginTop: '1rem' }}>
              <h2>Diário financeiro</h2>
              <table
                className="data-table gv-finance-print-table"
                style={{ width: '100%', fontSize: '0.75rem', marginTop: '0.5rem' }}
              >
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Natureza</th>
                    <th>Tipo</th>
                    <th className="num">Valor</th>
                    <th>Forma</th>
                    <th>Centro</th>
                    <th>Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {d.ledger.map((row, idx) => (
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
                      <td style={{ maxWidth: 100 }}>{row.referentialAccountLabel ?? '—'}</td>
                      <td style={{ maxWidth: 220 }}>
                        <strong>{row.title}</strong>
                        {row.detail ? <div style={{ opacity: 0.9 }}>{row.detail}</div> : null}
                      </td>
                    </tr>
                  ))}
                  {!d.ledger.length && (
                    <tr>
                      <td colSpan={7} className="empty">
                        Nenhum lançamento no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
