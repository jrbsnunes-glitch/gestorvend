import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import {
  buildProductMovementReportQuery,
  movementLabel,
  parseProductCodeBound,
  productReportBackTo,
} from '../lib/product-report-format';
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
  const [searchParams] = useSearchParams();
  const backTo = productReportBackTo(searchParams);

  const params = useMemo(() => movDraftFromSearchParams(searchParams), [searchParams]);

  const hasLegacyVariant = Boolean(params.variantId.trim());
  const cadFromN = parseCadMinBound(params.minStockCadFrom);
  const cadToN = parseCadMinBound(params.minStockCadTo);
  const cadOk =
    !hasLegacyVariant &&
    params.minStockCadFrom.trim() !== '' &&
    params.minStockCadTo.trim() !== '' &&
    cadFromN !== null &&
    cadToN !== null &&
    cadFromN <= cadToN;

  const qs = useMemo(
    () =>
      buildProductMovementReportQuery({
        variantId: hasLegacyVariant ? params.variantId : undefined,
        minStockCadFrom: hasLegacyVariant ? undefined : params.minStockCadFrom,
        minStockCadTo: hasLegacyVariant ? undefined : params.minStockCadTo,
        categoryId: params.categoryId || undefined,
        from: params.from,
        to: params.to,
        locationId: params.locationId || undefined,
        useMinControl: params.useMinControl,
        useMaxControl: params.useMaxControl,
        alertsOnly: params.alertsOnly,
        showNoMovement: params.showNoMovement,
        maxStockCeiling: params.maxStockCeiling,
      }),
    [params, hasLegacyVariant],
  );

  const enabled = Boolean(params.from && params.to && (hasLegacyVariant || cadOk));

  const report = useQuery({
    queryKey: ['reports', 'product-movements-print', qs],
    queryFn: () => api<MovementsResponse>(`/reports/product-movements?${qs}`),
    enabled,
  });

  const data = report.data;

  useEffect(() => {
    if (enabled && report.data) window.scrollTo({ top: 0 });
  }, [enabled, report.data]);

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
  ) : null;

  const sectionGate = !!data?.sections.length;

  if (!enabled) {
    return (
      <div className="print-page">
        <p className="print-empty no-print">
          Parâmetros inválidos. Volte em Produtos, abra Relatórios e informe período
          {hasLegacyVariant ? '' : ' e intervalo de código'} antes de gerar.
        </p>
        <button type="button" className="btn btn-primary no-print" onClick={() => navigate(backTo)}>
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate(backTo)}>
          ← Voltar
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir ou salvar PDF
        </button>
      </div>

      <div className="print-doc">
        <StandardReportHeader documentTitle="Movimentação de produtos" documentExtras={headerSubtitle} />

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
