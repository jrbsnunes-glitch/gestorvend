import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import {
  analyzeCashExpenseDiff,
  analyticalExpenseReconFootnote,
  presentedTotalFromSession,
  reconDiffDisplay,
  sumDeclaredForClosingBalance,
} from '../lib/cash-reconciliation';
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
  totalDiscounts: number;
  totalSurcharges: number;
  salesByMethod: Record<string, number>;
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
    totalSurcharges: number;
    openingBalance: number;
    presentedTotal: number;
    closingBalance: number;
    movementsIn: number;
    movementsOut: number;
    movementBreakdown: CashMovementBreakdown;
    salesByMethod: Record<string, number>;
    expectedByMethod: Record<string, number>;
    declaredByMethod: Record<string, number>;
  };
};

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
};

type ItemsReport = { items: SoldItemRow[] };

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
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

function filterSubtitle(opts: {
  from: string;
  to: string;
  controlFrom: string;
  controlTo: string;
  status: string;
  operatorLabel: string | null;
}): string {
  const parts: string[] = [];
  if (opts.controlFrom || opts.controlTo) {
    if (opts.controlFrom && opts.controlTo && opts.controlFrom !== opts.controlTo) {
      parts.push(`Controles #${opts.controlFrom}–#${opts.controlTo}`);
    } else if (opts.controlFrom) parts.push(`Controle ≥ #${opts.controlFrom}`);
    else parts.push(`Controle ≤ #${opts.controlTo}`);
  }
  if (opts.from && opts.to) {
    const f = parseLocalDate(opts.from);
    const t = parseLocalDate(opts.to);
    const same =
      f.getFullYear() === t.getFullYear() &&
      f.getMonth() === t.getMonth() &&
      f.getDate() === t.getDate();
    parts.push(same ? f.toLocaleDateString('pt-BR') : `${fmtDate(opts.from)} – ${fmtDate(opts.to)}`);
  }
  if (opts.operatorLabel) parts.push(opts.operatorLabel);
  if (opts.status === 'OPEN') parts.push('Abertos');
  else if (opts.status === 'CLOSED') parts.push('Fechados');
  else if (opts.status === 'RECONCILED') parts.push('Conferidos');
  return parts.join(' · ') || 'Filtro aplicado';
}

function sessionStatusLabel(s: ReportSession): string {
  if (s.reconciledAt) return 'Conferido';
  return s.status === 'OPEN' ? 'Aberto' : 'Fechado';
}

function sessionPresented(
  s: ReportSession,
  options?: { includeExpenseInPresentedTotal?: boolean },
): string {
  const total =
    s.presentedTotal ??
    presentedTotalFromSession(s.declaredByMethod, s.closingBalance, options);
  return total != null ? formatBRL(total) : '—';
}

export function CashPrintPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const userId = params.get('userId') ?? '';
  const controlFrom = params.get('controlFrom') ?? '';
  const controlTo = params.get('controlTo') ?? '';
  const status = (params.get('status') ?? 'ALL').toUpperCase();
  const includeItems =
    params.get('includeItems') === '1' || params.get('detailItems') === '1';
  const hasControlFilter = Boolean(controlFrom || controlTo);
  const hasDateFilter = Boolean(from && to);

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () => api<{ cashExpenseInPresentedTotal?: boolean }>('/company'),
  });
  const closingOptions = {
    includeExpenseInPresentedTotal: Boolean(companyQ.data?.cashExpenseInPresentedTotal),
  };

  const report = useQuery({
    queryKey: ['cash', 'report', { from, to, userId, controlFrom, controlTo, status }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (hasControlFilter) {
        if (controlFrom) qs.set('controlFrom', controlFrom);
        if (controlTo) qs.set('controlTo', controlTo);
      }
      if (hasDateFilter) {
        qs.set('from', from);
        qs.set('to', to);
      } else if (!hasControlFilter) {
        qs.set('from', from || new Date().toISOString().slice(0, 10));
        qs.set('to', to || new Date().toISOString().slice(0, 10));
      }
      if (userId) qs.set('userId', userId);
      if (status && status !== 'ALL') qs.set('status', status);
      return api<ReportData>(`/cash/report?${qs.toString()}`);
    },
    enabled: hasDateFilter || hasControlFilter,
  });

  const itemsFrom = from || (report.data?.from ? String(report.data.from).slice(0, 10) : '');
  const itemsTo = to || (report.data?.to ? String(report.data.to).slice(0, 10) : '');

  const itemsReport = useQuery({
    queryKey: [
      'cash',
      'report-items',
      itemsFrom,
      itemsTo,
      userId,
      includeItems,
      controlFrom,
      controlTo,
    ],
    queryFn: () => {
      const qs = new URLSearchParams({ status: 'COMPLETED' });
      if (itemsFrom && itemsTo) {
        qs.set('from', itemsFrom);
        qs.set('to', itemsTo);
      }
      if (userId) qs.set('userId', userId);
      if (controlFrom) qs.set('controlFrom', controlFrom);
      if (controlTo) qs.set('controlTo', controlTo);
      return api<ItemsReport>(`/cash/report/items?${qs.toString()}`);
    },
    enabled: includeItems && (Boolean(itemsFrom && itemsTo) || hasControlFilter),
  });

  const operators = useQuery({
    queryKey: ['users'],
    queryFn: () => api<Array<{ id: string; name: string; email: string }>>('/users'),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  const operatorLabel = useMemo(() => {
    if (!userId) return null;
    return operators.data?.find((u) => u.id === userId)?.name ?? null;
  }, [userId, operators.data]);

  const allMethods = useMemo(() => {
    const set = new Set<string>();
    Object.keys(report.data?.totals.salesByMethod ?? {}).forEach((k) => set.add(k));
    Object.keys(report.data?.totals.expectedByMethod ?? {}).forEach((k) => set.add(k));
    Object.keys(report.data?.totals.declaredByMethod ?? {}).forEach((k) => set.add(k));
    const order = ['CASH', 'CARD', 'PIX', 'CREDIT', 'OTHER'];
    return [...set].filter((k) => k !== 'EXPENSE').sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [report.data]);

  useEffect(() => {
    if (!report.isLoading && report.data) window.scrollTo({ top: 0 });
  }, [report.isLoading, report.data]);

  if (!hasDateFilter && !hasControlFilter) {
    return (
      <div className="print-page">
        <p>Parâmetros inválidos. Volte e selecione período ou controles.</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/caixa')}>
          Voltar
        </button>
      </div>
    );
  }

  const data = report.data;
  const subtitle = filterSubtitle({
    from,
    to,
    controlFrom,
    controlTo,
    status,
    operatorLabel,
  });

  return (
    <div className="print-page print-page--compact">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/caixa')}>
          ← Voltar
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      <div className="print-doc">
        <StandardReportHeader
          documentTitle="Relatório de Caixa"
          documentExtras={<p className="print-sub">{subtitle}</p>}
        />

        {report.isLoading && <p>Carregando…</p>}
        {report.isError && (
          <div className="alert alert-error">
            {(report.error as Error)?.message ?? 'Erro ao carregar relatório.'}
          </div>
        )}

        {data && (
          <>
            <section className="print-section">
              <h2>Caixas</h2>
              {data.sessions.length === 0 ? (
                <p className="print-empty">Nenhum caixa no filtro selecionado.</p>
              ) : (
                <table className="print-table print-table-compact">
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>Funcionário</th>
                      <th>Abertura</th>
                      <th>Fechamento</th>
                      <th className="num">Fundo</th>
                      <th>Status</th>
                      <th className="num">Vendas</th>
                      <th className="num">Total</th>
                      <th className="num">Apresentado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="num">{s.controlNumber}</td>
                        <td>{s.user?.name ?? '—'}</td>
                        <td>{fmtDateTime(s.openedAt)}</td>
                        <td>{fmtDateTime(s.closedAt)}</td>
                        <td className="num">{formatBRL(s.openingBalance)}</td>
                        <td>{sessionStatusLabel(s)}</td>
                        <td className="num">{s.completedCount}</td>
                        <td className="num">{formatBRL(s.totalCompleted)}</td>
                        <td className="num">{sessionPresented(s, closingOptions)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={5}>
                        {data.sessions.length} caixa(s) · Fundo {formatBRL(data.totals.openingBalance)}
                      </th>
                      <th />
                      <th className="num">{data.totals.completedCount}</th>
                      <th className="num">{formatBRL(data.totals.totalCompleted)}</th>
                      <th className="num">
                        {formatBRL(
                          data.totals.presentedTotal ??
                            (data.totals.closingBalance ||
                              sumDeclaredForClosingBalance(
                                data.totals.declaredByMethod,
                                closingOptions,
                              )),
                        )}
                      </th>
                    </tr>
                  </tfoot>
                </table>
              )}
              {(data.totals.totalDiscounts > 0 || (data.totals.totalSurcharges ?? 0) > 0) && (
                <p className="print-summary-line">
                  {data.totals.totalDiscounts > 0
                    ? `Descontos totais ${formatBRL(data.totals.totalDiscounts)}`
                    : null}
                  {data.totals.totalDiscounts > 0 && (data.totals.totalSurcharges ?? 0) > 0
                    ? ' · '
                    : null}
                  {(data.totals.totalSurcharges ?? 0) > 0
                    ? `Acréscimos totais ${formatBRL(data.totals.totalSurcharges)}`
                    : null}
                </p>
              )}
              {((data.totals.movementBreakdown?.suprimentos ?? 0) > 0 ||
                (data.totals.movementBreakdown?.sangrias ?? 0) > 0) && (
                <p className="print-summary-line">
                  {(data.totals.movementBreakdown?.suprimentos ?? 0) > 0
                    ? `Suprimentos ${formatBRL(data.totals.movementBreakdown.suprimentos)}`
                    : null}
                  {(data.totals.movementBreakdown?.suprimentos ?? 0) > 0 &&
                  (data.totals.movementBreakdown?.sangrias ?? 0) > 0
                    ? ' · '
                    : null}
                  {(data.totals.movementBreakdown?.sangrias ?? 0) > 0
                    ? `Sangrias ${formatBRL(data.totals.movementBreakdown.sangrias)}`
                    : null}
                </p>
              )}
            </section>

            <section className="print-section">
              <h2>Apresentado (conferência)</h2>
              <ReconSection
                methods={allMethods}
                sales={data.totals.salesByMethod}
                expected={data.totals.expectedByMethod}
                declared={
                  Object.keys(data.totals.declaredByMethod ?? {}).length
                    ? data.totals.declaredByMethod
                    : null
                }
                expenseAmount={
                  data.totals.expectedByMethod?.EXPENSE ??
                  data.totals.movementBreakdown?.despesas ??
                  0
                }
                includeExpenseInPresentedTotal={closingOptions.includeExpenseInPresentedTotal}
              />
            </section>

            {includeItems && (
              <section className="print-section">
                <h2>Itens vendidos</h2>
                {itemsReport.isLoading && <p className="print-empty">Carregando itens…</p>}
                {itemsReport.isError && (
                  <div className="alert alert-error">{(itemsReport.error as Error).message}</div>
                )}
                {itemsReport.data && <SoldItemsCompact items={itemsReport.data.items} />}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type ReconRow = {
  k: string;
  saleVal: number;
  ex: number;
  dec: number | null;
  diff: number | null;
};

function buildReconRows(
  methods: string[],
  sales: Record<string, number>,
  expected: Record<string, number>,
  declared: Record<string, number> | null,
): ReconRow[] {
  return methods
    .map((k) => {
      const saleVal = sales[k] ?? 0;
      const ex = expected[k] ?? 0;
      const dec = declared ? (declared[k] ?? 0) : null;
      const diff = dec == null ? null : dec - ex;
      return { k, saleVal, ex, dec, diff };
    })
    .filter((r) => r.saleVal > 0 || r.ex > 0 || (r.dec != null && r.dec > 0));
}

function ReconTableBody({
  rows,
  cashExpenseExplain,
  declared,
}: {
  rows: ReconRow[];
  cashExpenseExplain: ReturnType<typeof analyzeCashExpenseDiff>;
  declared: Record<string, number> | null;
}) {
  return (
    <>
      <tbody>
        {rows.map((r) => {
          const diffDisplay = reconDiffDisplay(
            r.diff,
            r.k === 'CASH' ? cashExpenseExplain : null,
            r.k === 'CASH',
          );
          return (
            <tr key={r.k}>
              <td>{PAYMENT_LABELS[r.k] ?? r.k}</td>
              <td className="num">{r.saleVal > 0 ? formatBRL(r.saleVal) : '—'}</td>
              <td className="num">{r.dec == null ? '—' : formatBRL(r.dec)}</td>
              <td className="num">{formatBRL(r.ex)}</td>
              <td className={'num ' + diffToneClass(diffDisplay.tone)}>
                {diffDisplay.label}
                {diffDisplay.explainNote ? (
                  <span className="print-recon-explained-note">{diffDisplay.explainNote}</span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th>Total</th>
          <th className="num">{formatBRL(rows.reduce((s, r) => s + r.saleVal, 0))}</th>
          <th className="num">
            {declared ? formatBRL(rows.reduce((s, r) => s + (r.dec ?? 0), 0)) : '—'}
          </th>
          <th className="num">{formatBRL(rows.reduce((s, r) => s + r.ex, 0))}</th>
          <th className="num">
            {declared
              ? fmtDiff(
                  rows.reduce((s, r) => s + (r.dec ?? 0), 0) -
                    rows.reduce((s, r) => s + r.ex, 0),
                )
              : '—'}
          </th>
        </tr>
      </tfoot>
    </>
  );
}

function ReconSection({
  methods,
  sales,
  expected,
  declared,
  expenseAmount,
  includeExpenseInPresentedTotal = false,
}: {
  methods: string[];
  sales: Record<string, number>;
  expected: Record<string, number>;
  declared: Record<string, number> | null;
  expenseAmount: number;
  includeExpenseInPresentedTotal?: boolean;
}) {
  const paymentRows = buildReconRows(methods, sales, expected, declared);

  const expenseExpected = expected.EXPENSE ?? expenseAmount;
  const expenseDeclared = declared ? (declared.EXPENSE ?? 0) : null;
  const expenseDiff = expenseDeclared == null ? null : expenseDeclared - expenseExpected;
  const showExpenseTable =
    expenseExpected > 0 ||
    (expenseDeclared != null && expenseDeclared > 0) ||
    includeExpenseInPresentedTotal;

  const cashRow = paymentRows.find((r) => r.k === 'CASH');
  const cashExpenseExplain = analyzeCashExpenseDiff({
    includeExpenseInPresentedTotal,
    cashExpected: cashRow?.ex ?? expected.CASH ?? 0,
    cashDeclared: cashRow?.dec ?? null,
    expenseExpected,
    expenseDeclared,
    grossCashSales: sales.CASH,
  });

  const expenseFootnote =
    !includeExpenseInPresentedTotal && expenseExpected > 0
      ? analyticalExpenseReconFootnote(expenseExpected)
      : null;

  if (paymentRows.length === 0 && !showExpenseTable) {
    return <p className="print-empty">Sem valores para conferência neste filtro.</p>;
  }

  const reconHead = (
    <thead>
      <tr>
        <th>Forma</th>
        <th className="num">Registrado</th>
        <th className="num">Apresentado</th>
        <th className="num">Esperado</th>
        <th className="num">Dif.</th>
      </tr>
    </thead>
  );

  return (
    <div className="print-recon-block">
      {paymentRows.length > 0 ? (
        <>
          <h3 className="print-recon-subtitle">Formas de pagamento</h3>
          <table className="print-table print-table-compact">
            {reconHead}
            <ReconTableBody
              rows={paymentRows}
              cashExpenseExplain={cashExpenseExplain}
              declared={declared}
            />
          </table>
        </>
      ) : null}

      {showExpenseTable ? (
        <>
          <h3 className="print-recon-subtitle print-recon-subtitle--expense">Despesas do caixa</h3>
          <table className="print-table print-table-compact print-table-expense">
            {reconHead}
            <tbody>
              <tr>
                <td>{PAYMENT_LABELS.EXPENSE}</td>
                <td className="num">—</td>
                <td className="num">{expenseDeclared == null ? '—' : formatBRL(expenseDeclared)}</td>
                <td className="num">{formatBRL(expenseExpected)}</td>
                <td className={'num ' + diffToneClass(reconDiffDisplay(expenseDiff, null).tone)}>
                  {fmtDiff(expenseDiff)}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th>Total despesas</th>
                <th className="num">—</th>
                <th className="num">{expenseDeclared == null ? '—' : formatBRL(expenseDeclared)}</th>
                <th className="num">{formatBRL(expenseExpected)}</th>
                <th className="num">{fmtDiff(expenseDiff)}</th>
              </tr>
            </tfoot>
          </table>
        </>
      ) : null}

      {expenseFootnote ? <p className="print-recon-footnote">{expenseFootnote}</p> : null}

      {paymentRows.length > 0 && showExpenseTable && !includeExpenseInPresentedTotal ? (
        <p className="print-recon-footnote print-recon-footnote--muted">
          Total registrado em vendas ({formatBRL(paymentRows.reduce((s, r) => s + r.saleVal, 0))}) −
          despesas ({formatBRL(expenseExpected)}) = total esperado de meios (
          {formatBRL(paymentRows.reduce((s, r) => s + r.ex, 0))}).
        </p>
      ) : null}
    </div>
  );
}

function SoldItemsCompact({ items }: { items: SoldItemRow[] }) {
  if (!items.length) return <p className="print-empty">Nenhum item no período.</p>;
  return (
    <table className="print-table print-table-compact">
      <thead>
        <tr>
          <th>Data</th>
          <th className="num">Venda</th>
          <th>Produto</th>
          <th className="num">Qtd</th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.itemId} className={it.saleStatus === 'CANCELLED' ? 'is-cancelled' : undefined}>
            <td>{fmtDateTime(it.saleCreatedAt)}</td>
            <td className="num">#{it.saleNumber}</td>
            <td>
              {it.productName}
              {it.sku ? ` · ${it.sku}` : ''}
            </td>
            <td className="num">{it.quantity}</td>
            <td className="num">{formatBRL(it.totalLine)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function diffToneClass(tone: string): string {
  if (tone === 'explained' || tone === 'ok') return 'is-ok is-explained';
  if (tone === 'over') return 'is-over';
  if (tone === 'short') return 'is-short';
  return '';
}

function fmtDiff(diff: number | null): string {
  if (diff == null) return '—';
  if (Math.abs(diff) < 0.005) return 'OK';
  return (diff > 0 ? '+' : '') + formatBRL(diff);
}
