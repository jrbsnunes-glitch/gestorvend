import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../../components/StandardReportHeader';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import {
  buildInventorySummaryQuery,
  INVENTORY_STATUS_LABEL,
  resolveInventoryControlRange,
} from '../../lib/inventory-report-format';
import '../cash-print.css';

type SummaryItem = {
  variantId: string;
  sku: string;
  barcode: string | null;
  productName: string;
  productControlNumber: number;
  systemQty: number;
  countedQty: number | null;
  diff: number | null;
  notes: string | null;
};

type SummaryLine = {
  id: string;
  controlNumber: number;
  status: string;
  locationCode: string;
  locationName: string;
  notes: string | null;
  userName: string | null;
  createdAt: string;
  postedAt: string | null;
  itemCount: number;
  countedCount: number;
  divergentCount: number;
  surplusQty: number;
  shortageQty: number;
  absDiffQty: number;
  items: SummaryItem[];
};

type SummaryResponse = {
  title: string;
  period: { from: string; to: string } | null;
  locationId: string | null;
  locationName: string | null;
  statusFilter: string[];
  controlInterval: { from: number; to: number } | null;
  note: string;
  lines: SummaryLine[];
  totals: {
    inventories: number;
    posted: number;
    items: number;
    divergentLines: number;
    surplusQty: number;
    shortageQty: number;
    absDiffQty: number;
  };
};

type Filters = {
  from: string;
  to: string;
  locationId: string;
  status: string;
  controlMin: string;
  controlMax: string;
};

function monthStartISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-01`;
}

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function draftFromSearchParams(sp: URLSearchParams): Filters {
  return {
    from: sp.get('from') ?? monthStartISO(),
    to: sp.get('to') ?? todayISO(),
    locationId: sp.get('locationId') ?? '',
    status: sp.get('status') ?? 'POSTED',
    controlMin: sp.get('controlMin') ?? '',
    controlMax: sp.get('controlMax') ?? '',
  };
}

function fmtQty(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function StockInventorySummaryPrintPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<Filters>(() => draftFromSearchParams(searchParams));
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const spKey = searchParams.toString();
  useEffect(() => {
    setDraft(draftFromSearchParams(searchParams));
  }, [spKey]);

  const qs = useMemo(
    () => {
      const ctrl = resolveInventoryControlRange(draft.controlMin, draft.controlMax);
      const hasControl = ctrl.ok && Boolean(ctrl.min && ctrl.max);
      return buildInventorySummaryQuery({
        from: hasControl ? undefined : draft.from || undefined,
        to: hasControl ? undefined : draft.to || undefined,
        locationId: draft.locationId || undefined,
        status: draft.status || undefined,
        controlMin: ctrl.ok ? ctrl.min : draft.controlMin || undefined,
        controlMax: ctrl.ok ? ctrl.max : draft.controlMax || undefined,
      });
    },
    [draft],
  );

  const enabled = useMemo(() => {
    const ctrl = resolveInventoryControlRange(draft.controlMin, draft.controlMax);
    if (!ctrl.ok) return false;
    return Boolean((ctrl.min && ctrl.max) || (draft.from && draft.to));
  }, [draft]);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const report = useQuery({
    queryKey: ['reports', 'inventory-summary', qs],
    queryFn: () => api<SummaryResponse>(`/reports/inventory-summary?${qs}`),
    enabled,
  });

  const data = report.data;

  function applyFilters() {
    setApplyErr(null);
    const ctrl = resolveInventoryControlRange(draft.controlMin, draft.controlMax);
    if (!ctrl.ok) {
      setApplyErr(ctrl.error);
      return;
    }
    const hasControl = Boolean(ctrl.min && ctrl.max);
    if (!hasControl && (!draft.from.trim() || !draft.to.trim())) {
      setApplyErr('Informe o período e/ou o nº de controle.');
      return;
    }
    setSearchParams(
      new URLSearchParams(
        buildInventorySummaryQuery({
          from: hasControl ? undefined : draft.from,
          to: hasControl ? undefined : draft.to,
          locationId: draft.locationId || undefined,
          status: draft.status || undefined,
          controlMin: ctrl.min,
          controlMax: ctrl.max,
        }),
      ),
      { replace: true },
    );
  }

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/estoque/inventario')}
        >
          ← Voltar
        </button>
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
        <div className="pm-move-filters__title">Filtros — Inventários (resumo)</div>
        {applyErr && <div className="alert alert-error pm-move-filters__alert">{applyErr}</div>}
        <div className="pm-move-filters__row" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="invs-from">De</label>
            <input
              id="invs-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="invs-to">Até</label>
            <input
              id="invs-to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="invs-loc">Local</label>
            <select
              id="invs-loc"
              value={draft.locationId}
              onChange={(e) => setDraft((d) => ({ ...d, locationId: e.target.value }))}
            >
              <option value="">Todos</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="invs-st">Status</label>
            <select
              id="invs-st"
              value={draft.status}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
            >
              <option value="POSTED">Postados</option>
              <option value="DRAFT">Rascunhos</option>
              <option value="CANCELLED">Cancelados</option>
              <option value="ALL">Todos</option>
            </select>
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="invs-cmin">Controle mín.</label>
            <input
              id="invs-cmin"
              inputMode="numeric"
              placeholder="opc."
              value={draft.controlMin}
              onChange={(e) => setDraft((d) => ({ ...d, controlMin: e.target.value }))}
              style={{ width: '5.5rem' }}
            />
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="invs-cmax">Controle máx.</label>
            <input
              id="invs-cmax"
              inputMode="numeric"
              placeholder="opc."
              value={draft.controlMax}
              onChange={(e) => setDraft((d) => ({ ...d, controlMax: e.target.value }))}
              style={{ width: '5.5rem' }}
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={applyFilters}>
            Atualizar relatório
          </button>
        </div>
      </div>

      <div className="print-doc">
        <StandardReportHeader
          documentTitle="Inventários — resumo"
          documentExtras={
            <>
              {data ? (
                <>
                  <p className="print-sub">
                    {data.period ? (
                      <>
                        Período: <strong>{formatDate(data.period.from)}</strong> a{' '}
                        <strong>{formatDate(data.period.to)}</strong>
                        {' · '}
                      </>
                    ) : null}
                    Local:{' '}
                    <strong>
                      {data.locationName ??
                        (data.locationId
                          ? locations.data?.find((l) => l.id === data.locationId)?.code
                          : null) ??
                        'todos'}
                    </strong>
                    {' · '}
                    Status:{' '}
                    <strong>
                      {data.statusFilter
                        .map((s) => INVENTORY_STATUS_LABEL[s] ?? s)
                        .join(', ')}
                    </strong>
                    {data.controlInterval ? (
                      <>
                        {' · '}
                        Controle:{' '}
                        <strong>
                          #{data.controlInterval.from}
                          {data.controlInterval.to !== data.controlInterval.from
                            ? ` – #${data.controlInterval.to}`
                            : ''}
                        </strong>
                      </>
                    ) : (
                      <> · Controle: todos</>
                    )}
                  </p>
                  <p className="print-sub" style={{ fontSize: '0.82rem' }}>
                    {data.note}
                  </p>
                </>
              ) : (
                <p className="print-sub">
                  Ajuste os filtros e clique em <strong>Atualizar relatório</strong>.
                </p>
              )}
            </>
          }
        />

        {report.isLoading && <p>Carregando…</p>}
        {report.isError && (
          <div className="alert alert-error">
            {(report.error as Error)?.message ?? 'Erro ao gerar relatório.'}
          </div>
        )}

        {data && (
          <>
            <section className="print-section">
              <div className="print-kpis">
                <div className="print-kpi">
                  <span>Inventários</span>
                  <strong>{data.totals.inventories}</strong>
                </div>
                <div className="print-kpi">
                  <span>Postados</span>
                  <strong>{data.totals.posted}</strong>
                </div>
                <div className="print-kpi">
                  <span>Itens</span>
                  <strong>{data.totals.items}</strong>
                </div>
                <div className="print-kpi">
                  <span>Linhas divergentes</span>
                  <strong>{data.totals.divergentLines}</strong>
                </div>
                <div className="print-kpi">
                  <span>Sobra (qtd)</span>
                  <strong>{fmtQty(data.totals.surplusQty)}</strong>
                </div>
                <div className="print-kpi">
                  <span>Falta (qtd)</span>
                  <strong>{fmtQty(data.totals.shortageQty)}</strong>
                </div>
              </div>
            </section>

            <section className="print-section">
              <h2 className="print-section-title">Inventários</h2>
              <table className="print-table print-table-compact">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>#</th>
                    <th style={{ width: 90 }}>Status</th>
                    <th>Local</th>
                    <th style={{ width: 130 }}>Postado em</th>
                    <th style={{ width: 70, textAlign: 'right' }}>Itens</th>
                    <th style={{ width: 70, textAlign: 'right' }}>Diverg.</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Sobra</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Falta</th>
                    <th>Operador</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="empty">
                        Nenhum inventário no filtro.
                      </td>
                    </tr>
                  ) : (
                    data.lines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <strong>#{l.controlNumber}</strong>
                        </td>
                        <td>{INVENTORY_STATUS_LABEL[l.status] ?? l.status}</td>
                        <td>
                          {l.locationCode} — {l.locationName}
                        </td>
                        <td>
                          {l.postedAt
                            ? new Date(l.postedAt).toLocaleString('pt-BR')
                            : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{l.itemCount}</td>
                        <td style={{ textAlign: 'right' }}>{l.divergentCount}</td>
                        <td style={{ textAlign: 'right' }}>{fmtQty(l.surplusQty)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtQty(l.shortageQty)}</td>
                        <td>{l.userName ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>

            {data.lines.map((inv) => (
              <section key={`items-${inv.id}`} className="print-section">
                <h2 className="print-section-title">
                  Itens — inventário #{inv.controlNumber}
                  <span style={{ fontWeight: 400, fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                    {inv.locationCode} · {inv.itemCount} produto(s)
                  </span>
                </h2>
                <table className="print-table print-table-compact">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th style={{ width: 90 }}>SKU</th>
                      <th style={{ width: 80, textAlign: 'right' }}>Sistema</th>
                      <th style={{ width: 80, textAlign: 'right' }}>Contado</th>
                      <th style={{ width: 80, textAlign: 'right' }}>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(inv.items ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty">
                          Nenhum item neste inventário.
                        </td>
                      </tr>
                    ) : (
                      (inv.items ?? []).map((it) => (
                        <tr key={`${inv.id}-${it.variantId}`}>
                          <td>
                            {it.productName}
                            <div style={{ fontSize: '0.75rem', opacity: 0.75 }}>
                              Cód. {it.productControlNumber}
                              {it.barcode ? ` · EAN ${it.barcode}` : ''}
                            </div>
                          </td>
                          <td>{it.sku}</td>
                          <td style={{ textAlign: 'right' }}>{fmtQty(it.systemQty)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {it.countedQty == null ? '—' : fmtQty(it.countedQty)}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              fontWeight: 600,
                              color:
                                it.diff == null || Math.abs(it.diff) <= 1e-9
                                  ? undefined
                                  : it.diff > 0
                                    ? '#166534'
                                    : '#b91c1c',
                            }}
                          >
                            {it.diff == null
                              ? '—'
                              : `${it.diff > 0 ? '+' : ''}${fmtQty(it.diff)}`}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
