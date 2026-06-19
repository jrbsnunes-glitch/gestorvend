import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import { isExcludedFromClosingTotal, presentedTotalFromSession, sumDeclaredForClosingBalance } from '../lib/cash-reconciliation';
import './cash-print.css';

type ReconciliationExpenseLine = {
  amount: number;
  notes: string | null;
  referentialAccountId: string;
  referentialAccount?: { id: string; code: string; description: string } | null;
};

type CashMovementBreakdown = {
  suprimentos: number;
  sangrias: number;
  despesas: number;
};

type ReportSession = {
  id: string;
  controlNumber: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  reconciledAt: string | null;
  openingBalance: string;
  closingBalance: string | null;
  presentedTotal: number | null;
  closingNotes: string | null;
  user: { id: string; name: string; email: string } | null;
  movementsIn: number;
  movementsOut: number;
  movementBreakdown: CashMovementBreakdown;
  completedCount: number;
  cancelledCount: number;
  itemsCount: number;
  totalCompleted: number;
  totalCancelled: number;
  /** Soma dos descontos em vendas concluídas (por linha + desconto no total do cupom). */
  totalDiscounts: number;
  expectedByMethod: Record<string, number>;
  declaredByMethod: Record<string, number> | null;
  diffByMethod: Record<string, number> | null;
  reconciliationExpenseDetails: ReconciliationExpenseLine[] | null;
};

type ReportData = {
  from: string;
  to: string;
  sessions: ReportSession[];
  totals: {
    completedCount: number;
    cancelledCount: number;
    itemsCount: number;
    totalCompleted: number;
    totalCancelled: number;
    totalDiscounts: number;
    openingBalance: number;
    presentedTotal: number;
    closingBalance: number;
    movementsIn: number;
    movementsOut: number;
    movementBreakdown: CashMovementBreakdown;
    expectedByMethod: Record<string, number>;
    declaredByMethod: Record<string, number>;
  };
};

type Me = { name: string; email: string };

type SoldItemRow = {
  saleId: string;
  saleNumber: number;
  saleStatus: string;
  saleCreatedAt: string;
  itemId: string;
  productName: string;
  sku: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  totalLine: string;
  payments: { method: string; amount: string }[];
};

type ItemsReport = {
  items: SoldItemRow[];
};

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  PIX: 'Pix',
  CREDIT: 'Crediário',
  OTHER: 'Outro',
  EXPENSE: 'Despesa',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

/**
 * Aceita uma string `YYYY-MM-DD` (formato dos query params) ou um ISO
 * timestamp completo. Para o caso `YYYY-MM-DD`, monta a data em fuso local
 * para evitar que `new Date("2026-05-12")` (que é UTC midnight) caia no dia
 * anterior em fusos negativos como o brasileiro.
 */
function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [, y, mo, d] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  return new Date(s);
}

function fmtDate(s: string): string {
  return parseLocalDate(s).toLocaleDateString('pt-BR');
}

function periodLabel(from: string, to: string): string {
  const f = parseLocalDate(from);
  const t = parseLocalDate(to);
  const sameDay =
    f.getFullYear() === t.getFullYear() &&
    f.getMonth() === t.getMonth() &&
    f.getDate() === t.getDate();
  return sameDay
    ? `Movimentação de ${f.toLocaleDateString('pt-BR')}`
    : `Período: ${f.toLocaleDateString('pt-BR')} até ${t.toLocaleDateString('pt-BR')}`;
}

function controlLabel(controlFrom: string, controlTo: string): string {
  if (controlFrom && controlTo && controlFrom !== controlTo) {
    return `Controles #${controlFrom} a #${controlTo}`;
  }
  if (controlFrom) return `A partir do controle #${controlFrom}`;
  if (controlTo) return `Até o controle #${controlTo}`;
  return 'Por número de controle';
}

export function CashPrintPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const userId = params.get('userId') ?? '';
  const controlFrom = params.get('controlFrom') ?? '';
  const controlTo = params.get('controlTo') ?? '';
  const detailItems = params.get('detailItems') === '1';
  const hasControlFilter = Boolean(controlFrom || controlTo);
  const hasDateFilter = Boolean(from && to);

  const report = useQuery({
    queryKey: ['cash', 'report', { from, to, userId, controlFrom, controlTo }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (hasControlFilter) {
        if (controlFrom) qs.set('controlFrom', controlFrom);
        if (controlTo) qs.set('controlTo', controlTo);
      } else {
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
      }
      if (userId) qs.set('userId', userId);
      return api<ReportData>(`/cash/report?${qs.toString()}`);
    },
    enabled: hasDateFilter || hasControlFilter,
  });

  const itemsReport = useQuery({
    queryKey: ['cash', 'report-items', from, to, userId, detailItems],
    queryFn: () => {
      const qs = new URLSearchParams({ from, to, status: 'COMPLETED' });
      if (userId) qs.set('userId', userId);
      return api<ItemsReport>(`/cash/report/items?${qs.toString()}`);
    },
    enabled: detailItems && hasDateFilter && !hasControlFilter,
  });

  const itemsBySession = useMemo(() => {
    const map = new Map<string, SoldItemRow[]>();
    if (!detailItems || !report.data?.sessions.length) return map;
    const items = itemsReport.data?.items ?? [];
    for (const session of report.data.sessions) {
      const start = new Date(session.openedAt).getTime();
      const end = session.closedAt ? new Date(session.closedAt).getTime() : Date.now();
      map.set(
        session.id,
        items.filter((it) => {
          const t = new Date(it.saleCreatedAt).getTime();
          return t >= start && t <= end;
        }),
      );
    }
    return map;
  }, [detailItems, itemsReport.data?.items, report.data?.sessions]);

  const operators = useQuery({
    queryKey: ['users'],
    queryFn: () => api<Array<{ id: string; name: string; email: string }>>('/users'),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  const operatorLabel = useMemo(() => {
    if (!userId) return null;
    const op = operators.data?.find((u) => u.id === userId);
    return op ? op.name : null;
  }, [userId, operators.data]);

  const me = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api<Me>('/users/me'),
    staleTime: 5 * 60_000,
  });

  const allMethods = useMemo(() => {
    const set = new Set<string>();
    Object.keys(report.data?.totals.expectedByMethod ?? {}).forEach((k) => set.add(k));
    Object.keys(report.data?.totals.declaredByMethod ?? {}).forEach((k) => set.add(k));
    for (const s of report.data?.sessions ?? []) {
      Object.keys(s.expectedByMethod).forEach((k) => set.add(k));
      Object.keys(s.declaredByMethod ?? {}).forEach((k) => set.add(k));
    }
    // Ordena por relevância padrão dos métodos
    const order = ['CASH', 'CARD', 'PIX', 'CREDIT', 'OTHER', 'EXPENSE'];
    return [...set].sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [report.data]);

  // Atalho útil: Ctrl+P / Cmd+P abre diálogo nativo do navegador (já é padrão,
  // mas reforçamos focando o documento ao carregar).
  useEffect(() => {
    if (!report.isLoading && report.data) {
      window.scrollTo({ top: 0 });
    }
  }, [report.isLoading, report.data]);

  if (!hasDateFilter && !hasControlFilter) {
    return (
      <div className="print-page">
        <p>Parâmetros inválidos. Volte e selecione um período ou controles.</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/caixa')}>
          Voltar
        </button>
      </div>
    );
  }

  const data = report.data;

  const subtitle = hasControlFilter
    ? controlLabel(controlFrom, controlTo)
    : periodLabel(from, to);

  return (
    <div className="print-page">
      {/* Toolbar visível só em tela (escondida na impressão) */}
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/caixa')}>
          ← Voltar
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          🖨 Imprimir agora
        </button>
      </div>

      <div className="print-doc">
        <StandardReportHeader
          documentTitle="Relatório de Caixa"
          documentExtras={
            <>
              <p className="print-sub">{subtitle}</p>
              {operatorLabel && (
                <p className="print-sub" style={{ marginTop: '0.15rem' }}>
                  Operador: <strong>{operatorLabel}</strong>
                </p>
              )}
            </>
          }
        />

        {report.isLoading && <p>Carregando…</p>}
        {report.isError && (
          <div className="alert alert-error">
            {(report.error as Error)?.message ?? 'Erro ao carregar relatório.'}
          </div>
        )}

        {data && (
          <>
            {/* Cabeçalho de totais consolidados */}
            <section className="print-section">
              <h2>Resumo do período</h2>
              <div className="print-kpis">
                <KpiPrint label="Caixas no período" value={String(data.sessions.length)} />
                <KpiPrint label="Vendas concluídas" value={String(data.totals.completedCount)} />
                <KpiPrint
                  label="Total vendido"
                  value={formatBRL(data.totals.totalCompleted)}
                  highlight
                />
                {data.totals.totalDiscounts > 0 ? (
                  <KpiPrint
                    label="Descontos (vendas concluídas)"
                    value={formatBRL(data.totals.totalDiscounts)}
                    muted
                  />
                ) : null}
                <KpiPrint label="Itens vendidos" value={String(data.totals.itemsCount)} />
                <KpiPrint
                  label="Vendas canceladas"
                  value={`${data.totals.cancelledCount} · ${formatBRL(data.totals.totalCancelled)}`}
                  muted
                />
                <KpiPrint
                  label="Suprimentos / Sangrias / Despesas"
                  value={`+${formatBRL(data.totals.movementBreakdown?.suprimentos ?? data.totals.movementsIn)} / −${formatBRL(data.totals.movementBreakdown?.sangrias ?? data.totals.movementsOut)} / −${formatBRL(data.totals.movementBreakdown?.despesas ?? 0)}`}
                  muted
                />
                <KpiPrint label="Fundos iniciais" value={formatBRL(data.totals.openingBalance)} />
                <KpiPrint
                  label="Apresentado (meios)"
                  value={formatBRL(
                    data.totals.presentedTotal ??
                      (data.totals.closingBalance ||
                        sumDeclaredForClosingBalance(data.totals.declaredByMethod)),
                  )}
                />
              </div>
            </section>

            {/* Conciliação consolidada */}
            <section className="print-section">
              <h2>Esperado × Apresentado · Consolidado por forma de pagamento</h2>
              <ReconTable
                methods={allMethods}
                expected={data.totals.expectedByMethod}
                declared={data.totals.declaredByMethod}
                emphasizeTotals
              />
            </section>

            {/* Detalhe por sessão */}
            <section className="print-section">
              <h2>Detalhamento por caixa</h2>
              {data.sessions.length === 0 ? (
                <p className="print-empty">Nenhum caixa no período selecionado.</p>
              ) : (
                <div className="print-sessions">
                  {data.sessions.map((s) => (
                    <SessionBlock
                      key={s.id}
                      session={s}
                      methods={allMethods}
                      soldItems={detailItems ? itemsBySession.get(s.id) : undefined}
                      itemsDetailLoading={detailItems && itemsReport.isLoading}
                    />
                  ))}
                </div>
              )}
            </section>

            <footer className="print-foot">
              <span>GestorVend · Relatório de Caixa · {fmtDate(from)} – {fmtDate(to)}</span>
              <span>Página gerada por {me.data?.name ?? '—'}</span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function KpiPrint({
  label,
  value,
  highlight,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={'print-kpi' + (highlight ? ' is-highlight' : muted ? ' is-muted' : '')}>
      <span className="print-kpi-label">{label}</span>
      <strong className="print-kpi-value">{value}</strong>
    </div>
  );
}

function ReconTable({
  methods,
  expected,
  declared,
  emphasizeTotals,
}: {
  methods: string[];
  expected: Record<string, number>;
  declared: Record<string, number> | null;
  emphasizeTotals?: boolean;
}) {
  const rows = methods
    .map((k) => {
      const ex = expected[k] ?? 0;
      const dec = declared ? declared[k] ?? 0 : null;
      const diff = dec == null ? null : dec - ex;
      return { k, ex, dec, diff };
    })
    .filter((r) => r.ex > 0 || (r.dec != null && r.dec > 0));

  if (rows.length === 0) {
    return <p className="print-empty">Sem movimentações por forma de pagamento.</p>;
  }

  const totalRows = emphasizeTotals
    ? rows.filter((r) => !isExcludedFromClosingTotal(r.k))
    : rows;
  const totalExpected = totalRows.reduce((s, r) => s + r.ex, 0);
  const totalDeclared = totalRows.reduce((s, r) => s + (r.dec ?? 0), 0);
  const totalDiff = declared ? totalDeclared - totalExpected : null;

  return (
    <table className="print-table">
      <thead>
        <tr>
          <th>Forma de pagamento</th>
          <th className="num">Esperado</th>
          <th className="num">Apresentado</th>
          <th className="num">Diferença</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.k}>
            <td>{PAYMENT_LABELS[r.k] ?? r.k}</td>
            <td className="num">{formatBRL(r.ex)}</td>
            <td className="num">{r.dec == null ? '—' : formatBRL(r.dec)}</td>
            <td className={'num ' + diffClass(r.diff)}>{fmtDiff(r.diff)}</td>
          </tr>
        ))}
      </tbody>
      {emphasizeTotals && (
        <tfoot>
          <tr>
            <th>Total (meios)</th>
            <th className="num">{formatBRL(totalExpected)}</th>
            <th className="num">{declared ? formatBRL(totalDeclared) : '—'}</th>
            <th className={'num ' + diffClass(totalDiff)}>{fmtDiff(totalDiff)}</th>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function diffClass(diff: number | null): string {
  if (diff == null) return '';
  if (Math.abs(diff) < 0.005) return 'is-ok';
  return diff > 0 ? 'is-over' : 'is-short';
}

function fmtDiff(diff: number | null): string {
  if (diff == null) return '—';
  if (Math.abs(diff) < 0.005) return 'OK';
  return (diff > 0 ? '+' : '') + formatBRL(diff);
}

function sessionPresentedLabel(session: ReportSession): string {
  const total =
    session.presentedTotal ??
    presentedTotalFromSession(session.declaredByMethod, session.closingBalance);
  return total != null ? formatBRL(total) : '—';
}

function SessionBlock({
  session,
  methods,
  soldItems,
  itemsDetailLoading,
}: {
  session: ReportSession;
  methods: string[];
  soldItems?: SoldItemRow[];
  itemsDetailLoading?: boolean;
}) {
  const itemsDetailMode = soldItems !== undefined;
  const breakdown = session.movementBreakdown ?? {
    suprimentos: session.movementsIn,
    sangrias: session.movementsOut,
    despesas: 0,
  };
  const expenseLines =
    session.reconciledAt && session.reconciliationExpenseDetails?.length
      ? session.reconciliationExpenseDetails
      : null;

  return (
    <article className="print-session">
      <header className="print-session-head">
        <div>
          <h3>
            <span className="print-control">#{session.controlNumber}</span>
            {session.user?.name ?? '—'}
            <span
              className={
                'print-pill ' + (session.status === 'OPEN' ? 'is-open' : 'is-closed')
              }
            >
              {session.status === 'OPEN' ? '● Aberto' : 'Fechado'}
            </span>
            {session.reconciledAt ? (
              <span className="print-pill is-closed" style={{ marginLeft: '0.35rem' }}>
                Conferido
              </span>
            ) : null}
          </h3>
          <p className="print-session-meta">
            Aberto em <strong>{fmtDateTime(session.openedAt)}</strong>
            {session.closedAt && (
              <>
                {' · '}
                Fechado em <strong>{fmtDateTime(session.closedAt)}</strong>
              </>
            )}
          </p>
        </div>
        {!itemsDetailMode ? (
          <dl className="print-session-side">
            <dt>Fundo inicial</dt>
            <dd>{formatBRL(session.openingBalance)}</dd>
            <dt>Apresentado (meios)</dt>
            <dd>{sessionPresentedLabel(session)}</dd>
            <dt>Itens vendidos</dt>
            <dd>{session.itemsCount}</dd>
          </dl>
        ) : null}
      </header>

      {!itemsDetailMode ? (
        <>
          <div className="print-session-stats">
            <div>
              <span>Vendas concluídas</span>
              <strong>{session.completedCount}</strong>
              <em>{formatBRL(session.totalCompleted)}</em>
            </div>
            {session.totalDiscounts > 0 ? (
              <div className="is-muted">
                <span>Descontos concedidos</span>
                <strong>{formatBRL(session.totalDiscounts)}</strong>
              </div>
            ) : null}
            <div className="is-muted">
              <span>Vendas canceladas</span>
              <strong>{session.cancelledCount}</strong>
              <em>{formatBRL(session.totalCancelled)}</em>
            </div>
            <div className="is-muted">
              <span>Suprimentos</span>
              <strong>+{formatBRL(breakdown.suprimentos)}</strong>
            </div>
            <div className="is-muted">
              <span>Sangrias</span>
              <strong>−{formatBRL(breakdown.sangrias)}</strong>
            </div>
            {breakdown.despesas > 0 || (session.declaredByMethod?.EXPENSE ?? 0) > 0 ? (
              <div className="is-muted">
                <span>Despesas</span>
                <strong>−{formatBRL(breakdown.despesas || Number(session.declaredByMethod?.EXPENSE ?? 0))}</strong>
              </div>
            ) : null}
          </div>

          <ReconTable
            methods={methods}
            expected={session.expectedByMethod}
            declared={session.declaredByMethod}
          />

          {expenseLines ? (
            <div style={{ marginTop: '0.65rem' }}>
              <strong style={{ fontSize: '0.82rem' }}>Despesas conferidas (detalhe)</strong>
              <table className="print-table print-table-compact" style={{ marginTop: '0.35rem' }}>
                <thead>
                  <tr>
                    <th>Centro de custo</th>
                    <th>Observação</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {expenseLines.map((line, ix) => (
                    <tr key={`${line.referentialAccountId}-${ix}`}>
                      <td>
                        {line.referentialAccount
                          ? `${line.referentialAccount.code} — ${line.referentialAccount.description}`
                          : line.referentialAccountId}
                      </td>
                      <td>{line.notes ?? '—'}</td>
                      <td className="num">{formatBRL(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      {itemsDetailMode ? (
        <div className="print-session-items print-session-items--only">
          {itemsDetailLoading ? (
            <p className="print-empty" style={{ marginTop: 0, fontSize: '0.82rem' }}>
              Carregando itens…
            </p>
          ) : soldItems.length > 0 ? (
            <SoldItemsTable items={soldItems} />
          ) : (
            <p className="print-empty" style={{ marginTop: 0, fontSize: '0.82rem' }}>
              Nenhum item vendido neste caixa.
            </p>
          )}
        </div>
      ) : null}

      {session.closingNotes && (
        <div className="print-notes">
          <strong>Observações do operador no fechamento:</strong>
          <p>{session.closingNotes}</p>
        </div>
      )}
    </article>
  );
}

function SoldItemsTable({ items }: { items: SoldItemRow[] }) {
  return (
    <table className="print-table print-table-compact">
      <thead>
        <tr>
          <th>Data / Hora</th>
          <th>Venda</th>
          <th>Produto</th>
          <th>SKU</th>
          <th className="num">Qtd</th>
          <th className="num">Unit.</th>
          <th className="num">Desc.</th>
          <th className="num">Tot. linha</th>
          <th>Pgto.</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.itemId}>
            <td>{fmtDateTime(it.saleCreatedAt)}</td>
            <td>#{it.saleNumber}</td>
            <td>{it.productName}</td>
            <td>{it.sku ?? '—'}</td>
            <td className="num">{Number(it.quantity)}</td>
            <td className="num">{formatBRL(it.unitPrice)}</td>
            <td className="num">{Number(it.discount) > 0 ? formatBRL(it.discount) : '—'}</td>
            <td className="num">{formatBRL(it.totalLine)}</td>
            <td>{paymentsLabel(it.payments)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function paymentsLabel(payments: { method: string; amount: string }[]): string {
  if (payments.length === 0) return '—';
  const map = new Map<string, number>();
  for (const p of payments) {
    map.set(p.method, (map.get(p.method) ?? 0) + Number(p.amount));
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${PAYMENT_LABELS[k] ?? k} ${formatBRL(v)}`)
    .join(' · ');
}
