import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../../components/StandardReportHeader';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { buildInventoryDivergenceQuery, resolveInventoryControlRange } from '../../lib/inventory-report-format';
import '../cash-print.css';

type DivergenceLine = {
  inventoryId: string;
  inventoryControlNumber: number;
  inventoryStatus: string;
  postedAt: string | null;
  locationCode: string;
  locationName: string;
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

type DivergenceResponse = {
  title: string;
  period: { from: string; to: string } | null;
  inventoryId: string | null;
  locationId: string | null;
  controlInterval: { from: number; to: number } | null;
  onlyDiffs: boolean;
  note: string;
  lines: DivergenceLine[];
  totals: {
    linesCount: number;
    divergentLines: number;
    surplusQty: number;
    shortageQty: number;
    absDiffQty: number;
    inventories: number;
  };
};

type Filters = {
  from: string;
  to: string;
  locationId: string;
  inventoryId: string;
  controlMin: string;
  controlMax: string;
  onlyDiffs: boolean;
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
    inventoryId: sp.get('inventoryId') ?? '',
    controlMin: sp.get('controlMin') ?? '',
    controlMax: sp.get('controlMax') ?? '',
    onlyDiffs: sp.get('onlyDiffs') === '1' || sp.get('onlyDiffs') === 'true',
  };
}

function fmtQty(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function StockInventoryDivergencePrintPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<Filters>(() => draftFromSearchParams(searchParams));
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const spKey = searchParams.toString();
  useEffect(() => {
    setDraft(draftFromSearchParams(searchParams));
  }, [spKey]);

  const qs = useMemo(() => {
    if (draft.inventoryId.trim()) {
      return buildInventoryDivergenceQuery({
        inventoryId: draft.inventoryId,
        onlyDiffs: draft.onlyDiffs,
      });
    }
    const ctrl = resolveInventoryControlRange(draft.controlMin, draft.controlMax);
    const hasControl = ctrl.ok && Boolean(ctrl.min && ctrl.max);
    return buildInventoryDivergenceQuery({
      from: hasControl ? undefined : draft.from || undefined,
      to: hasControl ? undefined : draft.to || undefined,
      locationId: draft.locationId || undefined,
      controlMin: ctrl.ok ? ctrl.min : undefined,
      controlMax: ctrl.ok ? ctrl.max : undefined,
      onlyDiffs: draft.onlyDiffs,
    });
  }, [draft]);

  const enabled = useMemo(() => {
    if (draft.inventoryId.trim()) return true;
    const ctrl = resolveInventoryControlRange(draft.controlMin, draft.controlMax);
    if (!ctrl.ok) return false;
    return Boolean((ctrl.min && ctrl.max) || (draft.from && draft.to));
  }, [draft]);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const inventories = useQuery({
    queryKey: ['stock-inventories', 'report-picker'],
    queryFn: () =>
      api<
        Array<{
          id: string;
          controlNumber: number;
          status: string;
          location: { code: string; name: string };
        }>
      >('/stock-inventories'),
  });

  const report = useQuery({
    queryKey: ['reports', 'inventory-divergences', qs],
    queryFn: () => api<DivergenceResponse>(`/reports/inventory-divergences?${qs}`),
    enabled,
  });

  const data = report.data;

  function applyFilters() {
    setApplyErr(null);
    if (draft.inventoryId.trim()) {
      setSearchParams(
        new URLSearchParams(
          buildInventoryDivergenceQuery({
            inventoryId: draft.inventoryId,
            onlyDiffs: draft.onlyDiffs,
          }),
        ),
        { replace: true },
      );
      return;
    }
    const ctrl = resolveInventoryControlRange(draft.controlMin, draft.controlMax);
    if (!ctrl.ok) {
      setApplyErr(ctrl.error);
      return;
    }
    const hasControl = Boolean(ctrl.min && ctrl.max);
    if (!hasControl && (!draft.from.trim() || !draft.to.trim())) {
      setApplyErr('Informe o inventário, o período ou o nº de controle.');
      return;
    }
    setSearchParams(
      new URLSearchParams(
        buildInventoryDivergenceQuery({
          from: hasControl ? undefined : draft.from,
          to: hasControl ? undefined : draft.to,
          locationId: draft.locationId || undefined,
          controlMin: ctrl.min,
          controlMax: ctrl.max,
          onlyDiffs: draft.onlyDiffs,
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
        <div className="pm-move-filters__title">Filtros — Divergências de inventário</div>
        {applyErr && <div className="alert alert-error pm-move-filters__alert">{applyErr}</div>}
        <div className="pm-move-filters__row" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
          <div className="field pm-move-filters__tinyfield" style={{ minWidth: '14rem' }}>
            <label htmlFor="invd-id">Inventário</label>
            <select
              id="invd-id"
              value={draft.inventoryId}
              onChange={(e) => setDraft((d) => ({ ...d, inventoryId: e.target.value }))}
            >
              <option value="">Todos no período</option>
              {(inventories.data ?? []).map((inv) => (
                <option key={inv.id} value={inv.id}>
                  #{inv.controlNumber} · {inv.status} · {inv.location.code}
                </option>
              ))}
            </select>
          </div>
          {!draft.inventoryId.trim() && (
            <>
              <div className="field pm-move-filters__tinyfield">
                <label htmlFor="invd-from">De</label>
                <input
                  id="invd-from"
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                />
              </div>
              <div className="field pm-move-filters__tinyfield">
                <label htmlFor="invd-to">Até</label>
                <input
                  id="invd-to"
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                />
              </div>
              <div className="field pm-move-filters__tinyfield">
                <label htmlFor="invd-loc">Local</label>
                <select
                  id="invd-loc"
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
                <label htmlFor="invd-cmin">Controle mín.</label>
                <input
                  id="invd-cmin"
                  inputMode="numeric"
                  placeholder="opc."
                  value={draft.controlMin}
                  onChange={(e) => setDraft((d) => ({ ...d, controlMin: e.target.value }))}
                  style={{ width: '5.5rem' }}
                />
              </div>
              <div className="field pm-move-filters__tinyfield">
                <label htmlFor="invd-cmax">Controle máx.</label>
                <input
                  id="invd-cmax"
                  inputMode="numeric"
                  placeholder="opc."
                  value={draft.controlMax}
                  onChange={(e) => setDraft((d) => ({ ...d, controlMax: e.target.value }))}
                  style={{ width: '5.5rem' }}
                />
              </div>
            </>
          )}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.86rem',
              alignSelf: 'flex-end',
              marginBottom: '0.35rem',
            }}
          >
            <input
              type="checkbox"
              checked={draft.onlyDiffs}
              onChange={(e) => setDraft((d) => ({ ...d, onlyDiffs: e.target.checked }))}
            />
            Só divergências
          </label>
          <button type="button" className="btn btn-primary" onClick={applyFilters}>
            Atualizar relatório
          </button>
        </div>
      </div>

      <div className="print-doc">
        <StandardReportHeader
          documentTitle={data?.title ?? 'Inventário — divergências'}
          documentExtras={
            <>
              {data ? (
                <>
                  <p className="print-sub">
                    {data.inventoryId ? (
                      <>
                        Inventário:{' '}
                        <strong>
                          #
                          {data.lines[0]?.inventoryControlNumber ??
                            data.inventoryId.slice(0, 8)}
                        </strong>
                      </>
                    ) : data.period ? (
                      <>
                        Período: <strong>{formatDate(data.period.from)}</strong> a{' '}
                        <strong>{formatDate(data.period.to)}</strong>
                        {data.controlInterval ? (
                          <>
                            {' · '}
                            Controle:{' '}
                            <strong>
                              #{data.controlInterval.from} – #{data.controlInterval.to}
                            </strong>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    {data.onlyDiffs ? ' · somente divergências' : ' · todas as contagens'}
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
                  <span>Linhas</span>
                  <strong>{data.totals.linesCount}</strong>
                </div>
                <div className="print-kpi">
                  <span>Divergentes</span>
                  <strong>{data.totals.divergentLines}</strong>
                </div>
                <div className="print-kpi">
                  <span>Inventários</span>
                  <strong>{data.totals.inventories}</strong>
                </div>
                <div className="print-kpi">
                  <span>Sobra</span>
                  <strong>{fmtQty(data.totals.surplusQty)}</strong>
                </div>
                <div className="print-kpi">
                  <span>Falta</span>
                  <strong>{fmtQty(data.totals.shortageQty)}</strong>
                </div>
              </div>
            </section>

            <section className="print-section">
              <h2 className="print-section-title">Itens</h2>
              <table className="print-table print-table-compact">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>Inv.</th>
                    <th>Produto</th>
                    <th style={{ width: 90 }}>SKU</th>
                    <th>Local</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Sistema</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Contado</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty">
                        Nenhuma linha no filtro.
                      </td>
                    </tr>
                  ) : (
                    data.lines.map((l) => (
                      <tr key={`${l.inventoryId}-${l.variantId}`}>
                        <td>
                          <strong>#{l.inventoryControlNumber}</strong>
                        </td>
                        <td>
                          {l.productName}
                          <div style={{ fontSize: '0.75rem', opacity: 0.75 }}>
                            Cód. {l.productControlNumber}
                            {l.barcode ? ` · EAN ${l.barcode}` : ''}
                          </div>
                        </td>
                        <td>{l.sku}</td>
                        <td>
                          {l.locationCode}
                          {l.postedAt ? (
                            <div style={{ fontSize: '0.72rem', opacity: 0.75 }}>
                              {new Date(l.postedAt).toLocaleString('pt-BR')}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ textAlign: 'right' }}>{fmtQty(l.systemQty)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {l.countedQty == null ? '—' : fmtQty(l.countedQty)}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontWeight: 600,
                            color:
                              l.diff == null || Math.abs(l.diff) <= 1e-9
                                ? undefined
                                : l.diff > 0
                                  ? '#166534'
                                  : '#b91c1c',
                          }}
                        >
                          {l.diff == null
                            ? '—'
                            : `${l.diff > 0 ? '+' : ''}${fmtQty(l.diff)}`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
