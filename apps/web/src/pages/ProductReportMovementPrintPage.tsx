import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { buildProductMovementReportQuery, movementLabel, parseProductCodeBound } from '../lib/product-report-format';
import './cash-print.css';

type MovementRow = {
  createdAt: string;
  locationCode: string;
  locationName: string;
  controlNumber: number;
  type: string;
  source: string;
  quantityInMove: string;
  balanceBefore: number;
  balanceAfter: number;
  belowMinStock: boolean;
  aboveMaxStock: boolean;
  reference: string | null;
  outboundReason: string | null;
};

type MovementsSection = {
  variant: { id: string; sku: string; productName: string; minStock: number; productControlNumber: number };
  meta: { hadMovementsInPeriod: boolean };
  rows: MovementRow[];
};

type MovementsResponse = {
  period: { from: string; to: string };
  locationId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  productCodeInterval: { from: number; to: number } | null;
  options: {
    useMinControl: boolean;
    useMaxControl: boolean;
    maxStockCeiling: number | null;
    alertsOnly: boolean;
    showNoMovement: boolean;
  };
  note: string;
  sections: MovementsSection[];
};

type MovDraft = {
  variantId: string;
  minStockCadFrom: string;
  minStockCadTo: string;
  categoryId: string;
  from: string;
  to: string;
  locationId: string;
  useMinControl: boolean;
  useMaxControl: boolean;
  alertsOnly: boolean;
  showNoMovement: boolean;
  maxStockCeiling: string;
};

function parseCadMinBound(raw: string): number | null {
  return parseProductCodeBound(raw);
}

function movDraftFromSearchParams(sp: URLSearchParams): MovDraft {
  return {
    variantId: sp.get('variantId') ?? '',
    minStockCadFrom: sp.get('minStockCadFrom') ?? '',
    minStockCadTo: sp.get('minStockCadTo') ?? '',
    categoryId: sp.get('categoryId') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    locationId: sp.get('locationId') ?? '',
    useMinControl: sp.get('useMinControl') !== '0',
    useMaxControl: sp.get('useMaxControl') === '1',
    alertsOnly: sp.get('alertsOnly') === '1',
    showNoMovement: sp.get('showNoMovement') === '1',
    maxStockCeiling: sp.get('maxStockCeiling') ?? '',
  };
}

function movementSectionEmptyText(
  sec: MovementsSection,
  opts: Pick<MovementsResponse['options'], 'alertsOnly'>,
): string {
  if (!sec.meta.hadMovementsInPeriod) return 'Sem movimentação registrada neste período.';
  if (opts.alertsOnly) return 'Houve movimento no período, mas nenhuma linha atende ao filtro de alertas.';
  return 'Nenhuma linha nesta seção.';
}

export function ProductReportMovementPrintPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<MovDraft>(() => movDraftFromSearchParams(searchParams));
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const spKey = searchParams.toString();
  useEffect(() => {
    setDraft(movDraftFromSearchParams(searchParams));
  }, [spKey]);

  const hasLegacyVariant = Boolean(draft.variantId.trim());
  const cadFromN = parseCadMinBound(draft.minStockCadFrom);
  const cadToN = parseCadMinBound(draft.minStockCadTo);
  const cadOk =
    !hasLegacyVariant &&
    draft.minStockCadFrom.trim() !== '' &&
    draft.minStockCadTo.trim() !== '' &&
    cadFromN !== null &&
    cadToN !== null &&
    cadFromN <= cadToN;

  const qs = useMemo(
    () =>
      buildProductMovementReportQuery({
        variantId: hasLegacyVariant ? draft.variantId : undefined,
        minStockCadFrom: hasLegacyVariant ? undefined : draft.minStockCadFrom,
        minStockCadTo: hasLegacyVariant ? undefined : draft.minStockCadTo,
        categoryId: draft.categoryId || undefined,
        from: draft.from,
        to: draft.to,
        locationId: draft.locationId || undefined,
        useMinControl: draft.useMinControl,
        useMaxControl: draft.useMaxControl,
        alertsOnly: draft.alertsOnly,
        showNoMovement: draft.showNoMovement,
        maxStockCeiling: draft.maxStockCeiling,
      }),
    [draft, hasLegacyVariant],
  );

  const enabled = Boolean(draft.from && draft.to && (hasLegacyVariant || cadOk));

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const categories = useQuery({
    queryKey: ['categories', 'product-movement-print'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/categories?q='),
  });

  const report = useQuery({
    queryKey: ['reports', 'product-movements-print', qs],
    queryFn: () => api<MovementsResponse>(`/reports/product-movements?${qs}`),
    enabled,
  });

  const data = report.data;

  function applyFilters() {
    setApplyErr(null);
    const vid = draft.variantId.trim();
    const from = draft.from.trim();
    const to = draft.to.trim();
    if (!from || !to) {
      setApplyErr('Informe o período (de / até).');
      return;
    }
    if (!vid) {
      if (draft.minStockCadFrom.trim() === '' || draft.minStockCadTo.trim() === '') {
        setApplyErr('Informe o intervalo de código do produto — “de” e “até”.');
        return;
      }
      const a = parseCadMinBound(draft.minStockCadFrom);
      const b = parseCadMinBound(draft.minStockCadTo);
      if (a === null || b === null) {
        setApplyErr('Intervalo inválido: use números válidos.');
        return;
      }
      if (a > b) {
        setApplyErr('“De” não pode ser maior que “até”.');
        return;
      }
    }
    if (draft.useMaxControl && !draft.maxStockCeiling.trim()) {
      setApplyErr('Informe o teto ao usar controle máximo.');
      return;
    }
    if (draft.alertsOnly && !draft.useMinControl && !(draft.useMaxControl && draft.maxStockCeiling.trim())) {
      setApplyErr('Para “somente alertas”, ative o mínimo e/ou o máximo com teto informado.');
      return;
    }

    const next = new URLSearchParams(
      buildProductMovementReportQuery({
        variantId: vid || undefined,
        minStockCadFrom: vid ? undefined : draft.minStockCadFrom,
        minStockCadTo: vid ? undefined : draft.minStockCadTo,
        categoryId: draft.categoryId || undefined,
        from,
        to,
        locationId: draft.locationId || undefined,
        useMinControl: draft.useMinControl,
        useMaxControl: draft.useMaxControl,
        alertsOnly: draft.alertsOnly,
        showNoMovement: draft.showNoMovement,
        maxStockCeiling: draft.maxStockCeiling,
      }),
    );
    setSearchParams(next, { replace: true });
  }

  const headerSubtitle = data ? (
    <>
      <p className="print-sub">
        Período {data.period.from} a {data.period.to}
        {data.locationId ? ' · Local filtrado nos parâmetros' : ''}
        {data.categoryName ? ` · Categoria: ${data.categoryName}` : ''}
        {data.productCodeInterval
          ? ` · Código produto: ${data.productCodeInterval.from} a ${data.productCodeInterval.to}`
          : null}
        {data.sections.length > 1 ? ` · ${data.sections.length} variações` : null}
      </p>
      <p className="print-sub" style={{ marginTop: '0.2rem', fontSize: '0.88rem' }}>
        Controles: mín={data.options.useMinControl ? 'sim' : 'não'}
        {', '}máx=
        {data.options.useMaxControl ? `sim (teto ${data.options.maxStockCeiling ?? '—'})` : 'não'}
        {', '}somente alertas={data.options.alertsOnly ? 'sim' : 'não'}
        {', '}sem lançamentos no período={data.options.showNoMovement ? 'incluir' : 'omitir'}.
      </p>
    </>
  ) : enabled ? (
    <p className="print-sub">Carregando…</p>
  ) : (
    <p className="print-sub">
      Defina o intervalo de código do produto e o período nos filtros abaixo e clique em{' '}
      <strong>Atualizar relatório</strong>.
    </p>
  );

  const sectionGate = !!data?.sections.length;

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/produtos')}>
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
          maxWidth: '100%',
        }}
      >
        <div className="pm-move-filters__title">Parâmetros e controles min / máx</div>
        {applyErr && <div className="alert alert-error pm-move-filters__alert">{applyErr}</div>}
        {hasLegacyVariant ? (
          <p className="pm-move-filters__legacy">
            Ligado por URL a <strong style={{ wordBreak: 'break-all' }}>variantId={draft.variantId}</strong> — período, local e
            opções continuam editáveis; para trabalhar só por intervalo, use Relatórios em Produtos.
          </p>
        ) : (
          <p className="pm-move-filters__hint">
            Por intervalo: entram <strong>todos os SKUs dos produtos</strong> cujo <strong>código sequencial</strong> estiver dentro do
            intervalo informado.
          </p>
        )}

        <div className="pm-move-filters__row">
          {!hasLegacyVariant && (
            <div className="pm-move-filters__cadgroup" aria-label="Intervalo código produto">
              <span className="pm-move-filters__muted-label">Código</span>
              <div className="field pm-move-filters__tinyfield">
                <label htmlFor="pm-cfrom">De</label>
                <input
                  id="pm-cfrom"
                  inputMode="numeric"
                  value={draft.minStockCadFrom}
                  onChange={(e) => setDraft((d) => ({ ...d, minStockCadFrom: e.target.value }))}
                  placeholder="1"
                  style={{ width: '5rem' }}
                />
              </div>
              <div className="field pm-move-filters__tinyfield">
                <label htmlFor="pm-cto">Até</label>
                <input
                  id="pm-cto"
                  inputMode="numeric"
                  value={draft.minStockCadTo}
                  onChange={(e) => setDraft((d) => ({ ...d, minStockCadTo: e.target.value }))}
                  placeholder="99"
                  style={{ width: '5rem' }}
                />
              </div>
            </div>
          )}
          {!hasLegacyVariant && (
            <div className="field pm-move-filters__tinyfield">
              <label htmlFor="pm-cat">Categoria</label>
              <select
                id="pm-cat"
                value={draft.categoryId}
                onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))}
              >
                <option value="">Todas</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="pm-from">Período de</label>
            <input
              id="pm-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="pm-to">Período até</label>
            <input id="pm-to" type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          </div>
          <div className="field pm-move-filters__locfield">
            <label htmlFor="pm-loc">Local</label>
            <select id="pm-loc" value={draft.locationId} onChange={(e) => setDraft((d) => ({ ...d, locationId: e.target.value }))}>
              <option value="">Todos</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pm-move-filters__row pm-move-filters__row--controls">
          <label className="pm-move-filters__chk">
            <input
              type="checkbox"
              checked={draft.useMaxControl}
              onChange={(e) => setDraft((d) => ({ ...d, useMaxControl: e.target.checked }))}
            />
            Teto máx.
          </label>
          <div className="field pm-move-filters__tinyfield pm-move-filters__teto">
            <label htmlFor="pm-max">Teto</label>
            <input
              id="pm-max"
              inputMode="decimal"
              placeholder="—"
              disabled={!draft.useMaxControl}
              value={draft.maxStockCeiling}
              onChange={(e) => setDraft((d) => ({ ...d, maxStockCeiling: e.target.value }))}
            />
          </div>
          <label className="pm-move-filters__chk">
            <input
              type="checkbox"
              checked={draft.useMinControl}
              onChange={(e) => setDraft((d) => ({ ...d, useMinControl: e.target.checked }))}
            />
            Usar mín. cadastrado
          </label>
          <label className="pm-move-filters__chk">
            <input
              type="checkbox"
              checked={draft.alertsOnly}
              onChange={(e) => setDraft((d) => ({ ...d, alertsOnly: e.target.checked }))}
            />
            Só linhas alerta
          </label>
          <label className="pm-move-filters__chk">
            <input
              title={hasLegacyVariant ? 'Opcão para relatório por intervalo na tela Produtos.' : undefined}
              type="checkbox"
              checked={draft.showNoMovement}
              disabled={hasLegacyVariant}
              onChange={(e) => setDraft((d) => ({ ...d, showNoMovement: e.target.checked }))}
            />
            Variantes sem lançamentos
          </label>
          <button type="button" className="btn btn-primary pm-move-filters__submit" onClick={() => applyFilters()}>
            Atualizar
          </button>
        </div>
        <p className="pm-move-filters__foot">
          Alertas: saldo após o movimento abaixo do mínimo da variação ou acima do teto. Por padrão não listamos SKUs sem
          lançamentos no período (marque <strong>Variantes sem lançamentos</strong> quando o intervalo cobre vários produtos).
        </p>
      </div>

      <div className="print-doc">
        <StandardReportHeader documentTitle="Movimentação de produtos" documentExtras={headerSubtitle} />

        {!enabled && (
          <p className="print-empty no-print">
            Informe período válido {hasLegacyVariant ? '' : 'e intervalo de código '}
            nos filtros e clique em <strong>Atualizar relatório</strong>.
          </p>
        )}

        {enabled && report.isLoading && <p>Carregando…</p>}
        {enabled && report.isError && (
          <div className="alert alert-error no-print">
            {(report.error as Error)?.message ?? 'Erro ao carregar relatório.'}
          </div>
        )}

        {!!data?.note && (
          <p className="print-sub" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
            {data.note}
          </p>
        )}

        {!sectionGate && data && enabled && (
          <p className="print-empty">
            Nenhum resultado neste relatório — ajuste o intervalo ou ative{' '}
            <strong>Variantes sem lançamentos</strong> quando buscar vários produtos.
          </p>
        )}

        {sectionGate &&
          data!.sections.map((sec) => (
            <div
              key={sec.variant.id}
              style={{ marginBottom: '1.85rem', pageBreakInside: 'avoid' }}
              className="print-movement-variant-block"
            >
              <h2 className="print-sub" style={{ fontSize: '1rem', margin: '0 0 0.65rem', fontWeight: 700 }}>
                {sec.variant.productName} <span style={{ fontWeight: 600 }}>({sec.variant.sku})</span>
                {' — '}
                <span style={{ fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                  Mín. SKUs esta variante {sec.variant.minStock} · código produto {sec.variant.productControlNumber}
                </span>
              </h2>
              {!sec.rows.length ? (
                <p className="print-empty" style={{ fontSize: '0.85rem' }}>
                  {movementSectionEmptyText(sec, data!.options)}
                </p>
              ) : (
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Local</th>
                      <th>Movimento</th>
                      <th className="num">Qtd*</th>
                      <th className="num">Antes</th>
                      <th className="num">Depois</th>
                      {data!.options.useMinControl ? <th>&lt; mín</th> : null}
                      {data!.options.useMaxControl ? <th>&gt; teto</th> : null}
                      <th>Ref.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((r, i) => (
                      <tr key={`${sec.variant.id}-${r.controlNumber}-${i}`}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.createdAt)}</td>
                        <td>
                          <span>{r.locationCode}</span>
                          <div style={{ fontSize: '0.78rem', color: '#475569' }}>{r.locationName}</div>
                        </td>
                        <td>{movementLabel(r.type, r.source)}</td>
                        <td className="num">{r.quantityInMove}</td>
                        <td className="num">{r.balanceBefore}</td>
                        <td className="num">{r.balanceAfter}</td>
                        {data!.options.useMinControl ? <td>{r.belowMinStock ? 'Sim' : '—'}</td> : null}
                        {data!.options.useMaxControl ? <td>{r.aboveMaxStock ? 'Sim' : '—'}</td> : null}
                        <td style={{ maxWidth: '180px', wordBreak: 'break-word', fontSize: '0.84rem' }}>
                          {[r.reference, r.outboundReason].filter(Boolean).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        <p className="print-foot" style={{ marginTop: '1rem' }}>
          * Em ajustes (inventário), o valor gravado reproduz a movimentação conforme modelo de dados.
        </p>
      </div>
    </div>
  );
}
