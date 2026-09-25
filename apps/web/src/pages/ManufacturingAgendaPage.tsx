import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ManufacturingProjectDetailModal } from '../components/ManufacturingProjectDetailModal';
import { ManufacturingStatusChip } from '../components/ManufacturingStatusChip';
import { api } from '../lib/api';
import { formatCalendarDate } from '../lib/format';
import { hasFactoryModule } from '../lib/auth';
import { useManufacturingCreateDraft } from '../context/manufacturing-create-draft';
import {
  addCalendarDays,
  addMonths,
  endOfMonth,
  monthGrid,
  monthTitle,
  startOfMonth,
  todayISODate,
  toLocalISODate,
} from '../lib/local-date';
import {
  MFG_KANBAN_COLS,
  MFG_STATUS_LABEL,
  mfgStatusChipStyle,
  type MfgStatus,
} from '../lib/manufacturing-labels';
import {
  buildPhaseSegments,
  clampSegmentToRange,
  formatTimelineDay,
  projectTimelineRange,
} from '../lib/manufacturing-phase-timeline';
import type { MfgScheduleProject } from '../lib/manufacturing-types';
import './manufacturing-agenda.css';

type CalMode = 'day' | 'week' | 'month';
type ViewMode = 'calendar' | 'timeline';

const WEEKDAYS_MON = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const;
const MONTH_VISIBLE = 3;

function promisedDayKey(p: MfgScheduleProject): string | null {
  if (!p.promisedAt) return null;
  return toLocalISODate(p.promisedAt);
}

function formatDayLabel(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

export function ManufacturingAgendaPage() {
  const moduleOk = hasFactoryModule();
  const { draft } = useManufacturingCreateDraft();
  const today = todayISODate();
  const [calMode, setCalMode] = useState<CalMode>('month');
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [date, setDate] = useState(today);
  const [detailId, setDetailId] = useState<string | null>(null);

  const from = calMode === 'month' ? startOfMonth(date) : date;
  const to =
    calMode === 'week' ? addCalendarDays(date, 6) : calMode === 'month' ? endOfMonth(date) : date;

  const scheduleQ = useQuery({
    queryKey: ['manufacturing', 'schedule', from, to],
    queryFn: () => {
      const q = new URLSearchParams({ from, to });
      return api<MfgScheduleProject[]>(`/manufacturing/projects/schedule?${q}`);
    },
    enabled: moduleOk,
  });

  const days = useMemo(() => {
    const n = calMode === 'week' ? 7 : 1;
    const list: string[] = [];
    for (let i = 0; i < n; i++) list.push(addCalendarDays(from, i));
    return list;
  }, [from, calMode]);

  const monthDays = useMemo(() => (calMode === 'month' ? monthGrid(date) : []), [date, calMode]);
  const monthKey = date.slice(0, 7);

  const unpromised = useMemo(
    () => (scheduleQ.data ?? []).filter((p) => !p.promisedAt),
    [scheduleQ.data],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, MfgScheduleProject[]>();
    const keys = calMode === 'month' ? monthDays : days;
    for (const d of keys) map.set(d, []);
    for (const p of scheduleQ.data ?? []) {
      const key = promisedDayKey(p);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    for (const [, rows] of map) {
      rows.sort((a, b) => a.number - b.number);
    }
    return map;
  }, [scheduleQ.data, days, monthDays, calMode]);

  function openDay(iso: string) {
    setDate(iso);
    setCalMode('day');
    setViewMode('calendar');
  }

  function renderProjectChip(p: MfgScheduleProject, compact?: boolean) {
    const st = mfgStatusChipStyle(p.status);
    return (
      <button
        key={p.id}
        type="button"
        className="mfg-agenda-month__item"
        style={{ background: st.background, color: st.color }}
        title={`#${p.number} ${p.customer.name} · ${MFG_STATUS_LABEL[p.status]}`}
        onClick={(e) => {
          e.stopPropagation();
          setDetailId(p.id);
        }}
      >
        {compact ? `#${p.number}` : `#${p.number} ${p.customer.name}`}
      </button>
    );
  }

  function renderDayList(day: string) {
    const rows = byDay.get(day) ?? [];
    return (
      <div key={day} className="card">
        <div className="mfg-agenda-day-card__head">{formatDayLabel(day)}</div>
        <div className="mfg-agenda-day-card__body">
          {scheduleQ.isLoading ? (
            <p className="muted" style={{ padding: '0.75rem' }}>
              Carregando…
            </p>
          ) : rows.length === 0 ? (
            <p className="muted" style={{ padding: '0.75rem' }}>
              Nenhum prazo neste dia.
            </p>
          ) : (
            rows.map((p) => (
              <button
                key={p.id}
                type="button"
                className="mfg-agenda-day-row"
                onClick={() => setDetailId(p.id)}
              >
                <div className="mfg-agenda-day-row__title">
                  #{p.number} · {p.customer.name}
                </div>
                <div className="mfg-agenda-day-row__meta">
                  {p.finishedVariant.product.name} · <ManufacturingStatusChip status={p.status} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  if (!moduleOk) {
    return (
      <div className="page">
        <p className="muted">Addon Fábrica não contratado.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Agenda da Fábrica</h1>
      <p className="page-desc">
        Prazos prometidos e linha do tempo das fases. Calendário agrupa pela{' '}
        <strong>data de entrega prometida</strong>.{' '}
        <Link to="/fabrica">Ver projetos</Link>
      </p>

      {draft.open ? (
        <div className="alert alert-ok" role="status" style={{ marginBottom: '0.75rem' }}>
          Você tem um <strong>novo projeto</strong> em preenchimento.{' '}
          <Link to="/fabrica">Voltar a Projetos</Link> para continuar o cadastro.
        </div>
      ) : null}

      <div className="card mfg-agenda-toolbar">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="mfg-ag-date">Referência</label>
          <input
            id="mfg-ag-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="mfg-agenda-toolbar__modes">
          <button
            type="button"
            className={`btn ${viewMode === 'calendar' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('calendar')}
          >
            Calendário
          </button>
          <button
            type="button"
            className={`btn ${viewMode === 'timeline' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('timeline')}
          >
            Linha do tempo
          </button>
          {viewMode === 'calendar' ? (
            <>
              <button
                type="button"
                className={`btn ${calMode === 'day' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setCalMode('day')}
              >
                Dia
              </button>
              <button
                type="button"
                className={`btn ${calMode === 'week' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setCalMode('week')}
              >
                Semana
              </button>
              <button
                type="button"
                className={`btn ${calMode === 'month' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setCalMode('month')}
              >
                Mês
              </button>
            </>
          ) : null}
        </div>
      </div>

      {scheduleQ.isError ? (
        <div className="alert alert-error">{(scheduleQ.error as Error).message}</div>
      ) : null}

      {viewMode === 'timeline' ? (
        <>
          <div className="mfg-agenda-legend">
            {MFG_KANBAN_COLS.map((st) => {
              const c = mfgStatusChipStyle(st);
              return (
                <span key={st} className="mfg-agenda-legend__item">
                  <span className="mfg-agenda-legend__swatch" style={{ background: c.background }} />
                  {MFG_STATUS_LABEL[st]}
                </span>
              );
            })}
            <span className="mfg-agenda-legend__item">
              <span
                className="mfg-agenda-legend__swatch"
                style={{ background: '#dc2626', width: '2px' }}
              />
              Prazo prometido
            </span>
          </div>
          <p className="mfg-agenda-timeline__hint muted">
            Cada barra usa a escala do projeto (abertura → entrega). A referência acima filtra quais
            projetos aparecem no mês.
          </p>
          <div className="mfg-agenda-timeline">
            {scheduleQ.isLoading ? (
              <p className="muted">Carregando…</p>
            ) : !(scheduleQ.data ?? []).length ? (
              <p className="muted">Nenhum projeto no intervalo.</p>
            ) : (
              (scheduleQ.data ?? []).map((p) => {
                const segments = buildPhaseSegments(
                  p.statusHistory,
                  p.createdAt,
                  p.status,
                  p.finishedAt,
                );
                const { startMs: rangeStartMs, endMs: rangeEndMs } = projectTimelineRange({
                  createdAt: p.createdAt,
                  promisedAt: p.promisedAt,
                  finishedAt: p.finishedAt,
                  segments,
                });
                const rangeSpan = Math.max(rangeEndMs - rangeStartMs, 1);
                const nowMs = Date.now();
                const todayInRange = nowMs >= rangeStartMs && nowMs <= rangeEndMs;
                const todayLeft = todayInRange
                  ? ((nowMs - rangeStartMs) / rangeSpan) * 100
                  : null;

                return (
                  <div key={p.id} className="card mfg-agenda-timeline__card">
                    <div className="mfg-agenda-timeline__head">
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        onClick={() => setDetailId(p.id)}
                      >
                        #{p.number} · {p.customer.name}
                      </button>
                      <ManufacturingStatusChip status={p.status} />
                    </div>
                    <p className="mfg-agenda-timeline__sub">
                      {p.finishedVariant.product.name}
                      {p.promisedAt ? ` · entrega ${formatCalendarDate(p.promisedAt)}` : ''}
                    </p>

                    <div className="mfg-agenda-timeline__axis">
                      <span>Início {formatTimelineDay(rangeStartMs)}</span>
                      <span>Fim {formatTimelineDay(rangeEndMs)}</span>
                    </div>

                    <div className="mfg-agenda-timeline__track">
                      {segments.map((seg, idx) => {
                        const clipped = clampSegmentToRange(seg, rangeStartMs, rangeEndMs);
                        if (!clipped) return null;
                        const left = ((clipped.startMs - rangeStartMs) / rangeSpan) * 100;
                        const widthPct = ((clipped.endMs - clipped.startMs) / rangeSpan) * 100;
                        const c = mfgStatusChipStyle(seg.status as MfgStatus);
                        const label = MFG_STATUS_LABEL[seg.status as MfgStatus];
                        const isCurrent = idx === segments.length - 1 && p.status === seg.status;
                        return (
                          <div
                            key={`${seg.status}-${idx}-${clipped.startMs}`}
                            className={`mfg-agenda-timeline__seg${isCurrent ? ' is-current' : ''}`}
                            style={{
                              left: `${left}%`,
                              width: `${Math.max(widthPct, 0)}%`,
                              background: c.background,
                              borderColor: c.color,
                              color: c.color,
                            }}
                            title={`${label} · ${formatTimelineDay(clipped.startMs)} → ${formatTimelineDay(clipped.endMs)}`}
                          >
                            {widthPct >= 8 ? (
                              <span className="mfg-agenda-timeline__seg-label">{label}</span>
                            ) : null}
                          </div>
                        );
                      })}
                      {todayLeft != null ? (
                        <div
                          className="mfg-agenda-timeline__today"
                          style={{ left: `${todayLeft}%` }}
                          title="Hoje"
                        />
                      ) : null}
                      {p.promisedAt ? (
                        <div
                          className="mfg-agenda-timeline__promise"
                          style={{
                            left: `${((new Date(`${toLocalISODate(p.promisedAt)}T12:00:00`).getTime() - rangeStartMs) / rangeSpan) * 100}%`,
                          }}
                          title={`Prazo prometido · ${formatCalendarDate(p.promisedAt)}`}
                        >
                          <span className="mfg-agenda-timeline__promise-tag">Entrega</span>
                        </div>
                      ) : null}
                    </div>

                    <ul className="mfg-agenda-timeline__steps" aria-label="Fases do projeto">
                      {segments.map((seg, idx) => {
                        const clipped = clampSegmentToRange(seg, rangeStartMs, rangeEndMs);
                        if (!clipped) return null;
                        const c = mfgStatusChipStyle(seg.status as MfgStatus);
                        const isCurrent = idx === segments.length - 1 && p.status === seg.status;
                        return (
                          <li key={`step-${seg.status}-${idx}`}>
                            <span
                              className="mfg-agenda-timeline__step-dot"
                              style={{ background: c.background, borderColor: c.color }}
                            />
                            <span className="mfg-agenda-timeline__step-text">
                              <strong>{MFG_STATUS_LABEL[seg.status as MfgStatus]}</strong>
                              {isCurrent ? ' (atual)' : ''}
                              {' · '}
                              {formatTimelineDay(clipped.startMs)}
                              {clipped.endMs > clipped.startMs + 60_000
                                ? ` – ${formatTimelineDay(clipped.endMs)}`
                                : ''}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : calMode === 'month' ? (
        <div className="card mfg-agenda-month">
          <div className="mfg-agenda-month__nav">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDate(addMonths(date, -1))}
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <strong className="mfg-agenda-month__title">{monthTitle(date)}</strong>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDate(addMonths(date, 1))}
              aria-label="Próximo mês"
            >
              ›
            </button>
          </div>
          <div className="mfg-agenda-month__weekdays">
            {WEEKDAYS_MON.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          {scheduleQ.isLoading ? (
            <p className="muted" style={{ padding: '0.75rem' }}>
              Carregando…
            </p>
          ) : null}
          <div className="mfg-agenda-month__grid">
            {monthDays.map((day) => {
              const rows = byDay.get(day) ?? [];
              const extra = Math.max(0, rows.length - MONTH_VISIBLE);
              const visible = rows.slice(0, MONTH_VISIBLE);
              const inMonth = day.startsWith(monthKey);
              return (
                <button
                  key={day}
                  type="button"
                  className={[
                    'mfg-agenda-month__cell',
                    inMonth ? '' : 'is-outside',
                    day === today ? 'is-today' : '',
                    day === date ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => openDay(day)}
                >
                  <span className="mfg-agenda-month__daynum">{Number(day.slice(8))}</span>
                  <div className="mfg-agenda-month__items">
                    {visible.map((p) => renderProjectChip(p, true))}
                    {extra > 0 ? (
                      <div className="mfg-agenda-month__more">
                        +{extra} projeto{extra > 1 ? 's' : ''}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={`mfg-agenda-days${calMode === 'week' ? ' mfg-agenda-days--week' : ''}`}>
          {days.map((d) => renderDayList(d))}
        </div>
      )}

      {viewMode === 'calendar' && unpromised.length > 0 ? (
        <section className="card mfg-agenda-unpromised">
          <h2 style={{ fontSize: '0.95rem', marginTop: 0 }}>Sem prazo prometido</h2>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            Projetos ativos no período sem prazo prometido — defina a data no projeto.
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {unpromised.map((p) => (
              <li key={p.id}>
                <button type="button" className="btn btn-ghost btn-compact" onClick={() => setDetailId(p.id)}>
                  #{p.number} {p.customer.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detailId ? (
        <ManufacturingProjectDetailModal projectId={detailId} onClose={() => setDetailId(null)} />
      ) : null}
    </div>
  );
}
