import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import './cash-print.css';

type ReportSession = {
  id: string;
  controlNumber: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingBalance: string;
  closingBalance: string | null;
  closingNotes: string | null;
  user: { id: string; name: string; email: string } | null;
  movementsIn: number;
  movementsOut: number;
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
    closingBalance: number;
    movementsIn: number;
    movementsOut: number;
    expectedByMethod: Record<string, number>;
    declaredByMethod: Record<string, number>;
  };
};

type Me = { name: string; email: string };

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
    const order = ['CASH', 'CARD', 'PIX', 'CREDIT', 'OTHER'];
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
                  label="Suprimentos / Sangrias"
                  value={`+${formatBRL(data.totals.movementsIn)} / −${formatBRL(data.totals.movementsOut)}`}
                  muted
                />
                <KpiPrint label="Fundos iniciais" value={formatBRL(data.totals.openingBalance)} />
                <KpiPrint
                  label="Apresentado (total)"
                  value={formatBRL(data.totals.closingBalance || sumValues(data.totals.declaredByMethod))}
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
                    <SessionBlock key={s.id} session={s} methods={allMethods} />
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

function sumValues(obj: Record<string, number>): number {
  return Object.values(obj).reduce((a, b) => a + b, 0);
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

  const totalExpected = rows.reduce((s, r) => s + r.ex, 0);
  const totalDeclared = rows.reduce((s, r) => s + (r.dec ?? 0), 0);
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
            <th>Total</th>
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

function SessionBlock({
  session,
  methods,
}: {
  session: ReportSession;
  methods: string[];
}) {
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
        <dl className="print-session-side">
          <dt>Fundo inicial</dt>
          <dd>{formatBRL(session.openingBalance)}</dd>
          <dt>Saldo apresentado</dt>
          <dd>{session.closingBalance ? formatBRL(session.closingBalance) : '—'}</dd>
          <dt>Itens vendidos</dt>
          <dd>{session.itemsCount}</dd>
        </dl>
      </header>

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
          <strong>+{formatBRL(session.movementsIn)}</strong>
        </div>
        <div className="is-muted">
          <span>Sangrias</span>
          <strong>−{formatBRL(session.movementsOut)}</strong>
        </div>
      </div>

      <ReconTable
        methods={methods}
        expected={session.expectedByMethod}
        declared={session.declaredByMethod}
      />

      {session.closingNotes && (
        <div className="print-notes">
          <strong>Observações do operador no fechamento:</strong>
          <p>{session.closingNotes}</p>
        </div>
      )}
    </article>
  );
}
