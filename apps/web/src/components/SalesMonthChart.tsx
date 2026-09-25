import { useMemo, useState } from 'react';
import { formatBRL } from '../lib/format';
import type { MonthSalesPoint } from '../lib/month-sales-chart';

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function dayOfMonth(iso: string): string {
  return iso.slice(8, 10);
}

function dayLabel(iso: string): string {
  const d = isoToDate(iso);
  return `${dayOfMonth(iso)}/${String(d.getMonth() + 1).padStart(2, '0')} · ${WEEKDAY_SHORT[d.getDay()]}`;
}

function monthLabel(iso: string): string {
  return isoToDate(iso).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function isWeekend(iso: string): boolean {
  const dow = isoToDate(iso).getDay();
  return dow === 0 || dow === 6;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Rótulos curtos do eixo Y (mil / mi) para não competir com as barras. */
function shortBRL(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace('.', ',')} mil`;
  return value.toFixed(0);
}

type Variation = { pct: number | null; diff: number; from: MonthSalesPoint } | null;

/** Variação do dia em relação ao dia anterior do mês (null no dia 01). */
function variationAt(points: MonthSalesPoint[], index: number): Variation {
  const current = points[index];
  const previous = points[index - 1];
  if (!current || !previous) return null;
  const diff = current.revenue - previous.revenue;
  const pct = previous.revenue > 0 ? (diff / previous.revenue) * 100 : null;
  return { pct, diff, from: previous };
}

function variationText(v: Variation): string {
  if (!v) return 'Primeiro dia do mês';
  if (Math.abs(v.diff) < 0.005) return 'Estável';
  const sign = v.diff > 0 ? '+' : '−';
  if (v.pct == null) return `${sign}${formatBRL(Math.abs(v.diff))}`;
  return `${sign}${Math.abs(v.pct).toFixed(v.pct >= 100 ? 0 : 1).replace('.', ',')}%`;
}

function variationTone(v: Variation): 'up' | 'down' | 'flat' {
  if (!v || Math.abs(v.diff) < 0.005) return 'flat';
  return v.diff > 0 ? 'up' : 'down';
}

export function SalesMonthChart({
  points,
  loading = false,
}: {
  points: MonthSalesPoint[];
  loading?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const stats = useMemo(() => {
    if (!points.length) return null;
    const today = todayIso();
    const total = points.reduce((s, p) => s + p.revenue, 0);
    const salesCount = points.reduce((s, p) => s + p.count, 0);
    const soldDays = points.filter((p) => p.revenue > 0);

    let bestIdx = -1;
    let worstIdx = -1;
    points.forEach((p, i) => {
      if (p.revenue <= 0) return;
      if (bestIdx < 0 || p.revenue > points[bestIdx]!.revenue) bestIdx = i;
      if (worstIdx < 0 || p.revenue < points[worstIdx]!.revenue) worstIdx = i;
    });
    if (soldDays.length === 1) worstIdx = -1;

    const maxRevenue = bestIdx >= 0 ? points[bestIdx]!.revenue : 0;
    const avgSoldDay = soldDays.length ? total / soldDays.length : 0;
    const scaleTop = maxRevenue > 0 ? maxRevenue : 1;

    return {
      today,
      total,
      salesCount,
      soldDaysCount: soldDays.length,
      avgTicket: salesCount > 0 ? total / salesCount : 0,
      bestIdx,
      worstIdx,
      maxRevenue,
      avgSoldDay,
      scaleTop,
      avgLinePct: maxRevenue > 0 ? (avgSoldDay / scaleTop) * 100 : 0,
      monthTitle: monthLabel(points[0]!.date),
    };
  }, [points]);

  if (loading) {
    return (
      <div className="smc smc--loading" aria-busy="true">
        <div className="smc__skeleton smc__skeleton--kpis" />
        <div className="smc__skeleton smc__skeleton--plot" />
      </div>
    );
  }

  if (!stats) return <p className="dash-empty">Sem dados de vendas para o mês.</p>;

  const todayIdx = points.findIndex((p) => p.date === stats.today);
  const focusIdx = hoverIdx ?? (todayIdx >= 0 ? todayIdx : points.length - 1);
  const focus = points[focusIdx]!;
  const focusVariation = variationAt(points, focusIdx);
  const best = stats.bestIdx >= 0 ? points[stats.bestIdx]! : null;
  const worst = stats.worstIdx >= 0 ? points[stats.worstIdx]! : null;

  const tooltipAlign = focusIdx <= 1 ? 'start' : focusIdx >= points.length - 2 ? 'end' : 'center';

  return (
    <div className="smc">
      <div className="smc__head">
        <p className="smc__caption">
          Faturamento por dia (vendas concluídas) · <span>{stats.monthTitle}</span>
        </p>
        <ul className="smc__legend">
          <li className="smc__legend-item smc__legend-item--best">Melhor dia</li>
          <li className="smc__legend-item smc__legend-item--worst">Dia mais fraco</li>
          <li className="smc__legend-item smc__legend-item--avg">Média por dia com vendas</li>
        </ul>
      </div>

      <div className="smc__kpis">
        <div className="smc__kpi smc__kpi--total">
          <span className="smc__kpi-label">Acumulado no mês</span>
          <strong className="smc__kpi-value">{formatBRL(stats.total)}</strong>
          <span className="smc__kpi-hint">
            {stats.salesCount} venda(s) · ticket {formatBRL(stats.avgTicket)}
          </span>
        </div>

        <div className="smc__kpi smc__kpi--best">
          <span className="smc__kpi-label">Melhor dia</span>
          <strong className="smc__kpi-value">{best ? formatBRL(best.revenue) : '—'}</strong>
          <span className="smc__kpi-hint">
            {best ? `${dayLabel(best.date)} · ${best.count} venda(s)` : 'sem vendas no mês'}
          </span>
        </div>

        <div className="smc__kpi smc__kpi--worst">
          <span className="smc__kpi-label">Dia com menos vendas</span>
          <strong className="smc__kpi-value">{worst ? formatBRL(worst.revenue) : '—'}</strong>
          <span className="smc__kpi-hint">
            {worst
              ? `${dayLabel(worst.date)} · ${worst.count} venda(s)`
              : 'precisa de 2 dias com vendas'}
          </span>
        </div>

        <div className={`smc__kpi smc__kpi--var is-${variationTone(focusVariation)}`}>
          <span className="smc__kpi-label">
            {hoverIdx != null ? 'Variação do dia' : 'Variação de hoje'}
          </span>
          <strong className="smc__kpi-value">{variationText(focusVariation)}</strong>
          <span className="smc__kpi-hint">
            {focusVariation
              ? `${dayLabel(focus.date)} vs ${dayOfMonth(focusVariation.from.date)}`
              : dayLabel(focus.date)}
          </span>
        </div>
      </div>

      <div className="smc__plot">
        <div className="smc__axis" aria-hidden>
          <span>{shortBRL(stats.scaleTop)}</span>
          <span>{shortBRL(stats.scaleTop / 2)}</span>
          <span>0</span>
        </div>

        <div
          className="smc__canvas"
          role="img"
          aria-label={`Faturamento diário de ${stats.monthTitle}: total ${formatBRL(stats.total)} em ${stats.soldDaysCount} dia(s) com vendas`}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <span className="smc__grid smc__grid--top" />
          <span className="smc__grid smc__grid--mid" />
          {stats.maxRevenue > 0 ? (
            <span
              className="smc__avg-line"
              style={{
                bottom: `calc(var(--smc-day-h) + var(--smc-plot-h) * ${(stats.avgLinePct / 100).toFixed(4)})`,
              }}
              title={`Média por dia com vendas: ${formatBRL(stats.avgSoldDay)}`}
            />
          ) : null}

          <div className="smc__bars">
            {points.map((p, i) => {
              const pct = p.revenue > 0 ? Math.max(2.5, (p.revenue / stats.scaleTop) * 100) : 0;
              const classes = [
                'smc__col',
                i === stats.bestIdx ? 'is-best' : '',
                i === stats.worstIdx ? 'is-worst' : '',
                p.date === stats.today ? 'is-today' : '',
                isWeekend(p.date) ? 'is-weekend' : '',
                p.revenue > 0 ? '' : 'is-empty',
                i === focusIdx ? 'is-focus' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  type="button"
                  key={p.date}
                  className={classes}
                  onMouseEnter={() => setHoverIdx(i)}
                  onFocus={() => setHoverIdx(i)}
                  onBlur={() => setHoverIdx(null)}
                  aria-label={`${dayLabel(p.date)}: ${formatBRL(p.revenue)}, ${p.count} venda(s)`}
                >
                  <span className="smc__col-track">
                    <span className="smc__col-fill" style={{ height: `${pct}%` }} />
                  </span>
                  <span className="smc__col-day">{dayOfMonth(p.date)}</span>
                </button>
              );
            })}
          </div>

          <div
            className={`smc__tip smc__tip--${tooltipAlign}`}
            style={{ left: `${((focusIdx + 0.5) / points.length) * 100}%` }}
            role="status"
          >
            <strong className="smc__tip-day">
              {dayLabel(focus.date)}
              {focus.date === stats.today ? ' · hoje' : ''}
            </strong>
            <span className="smc__tip-value">{formatBRL(focus.revenue)}</span>
            <span className="smc__tip-meta">
              {focus.count} venda(s)
              {focusVariation ? ` · ${variationText(focusVariation)} vs dia anterior` : ''}
            </span>
            {focusIdx === stats.bestIdx ? (
              <span className="smc__tip-tag smc__tip-tag--best">melhor dia do mês</span>
            ) : null}
            {focusIdx === stats.worstIdx ? (
              <span className="smc__tip-tag smc__tip-tag--worst">dia mais fraco</span>
            ) : null}
          </div>
        </div>
      </div>

      <p className="smc__foot">
        {stats.maxRevenue > 0
          ? `Média ${formatBRL(stats.avgSoldDay)} nos ${stats.soldDaysCount} dia(s) com vendas · passe o mouse nas colunas para ver cada dia.`
          : 'Nenhuma venda concluída neste mês até agora — o eixo mostra os dias já decorridos.'}
      </p>
    </div>
  );
}
