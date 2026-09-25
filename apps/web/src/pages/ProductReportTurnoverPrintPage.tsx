import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import {
  buildProductTurnoverReportQuery,
  parseProductCodeBound,
  productReportBackTo,
} from '../lib/product-report-format';
import './cash-print.css';

type TurnoverResponse = {
  methodology: string;
  period: { from: string; to: string };
  categoryId: string | null;
  categoryName: string | null;
  productCodeInterval: { from: number; to: number } | null;
  options: {
    useMinControl: boolean;
    useMaxControl: boolean;
    maxStockCeiling: number | null;
    alertsOnly: boolean;
    showNoSale: boolean;
    showPeakSalesPeriod?: boolean;
  };
  peakSalesPeriod?: {
    hourFrom: number;
    hourTo: number;
    label: string;
    movementQty: number;
  } | null;
  lines: Array<{
    variantId: string;
    sku: string;
    productName: string;
    minStock: number;
    productControlNumber: number;
    stockOnHand: number;
    belowMinStock: boolean;
    aboveMaxStock: boolean;
    qtySold: number;
    revenue: number;
    avgSalePrice: number;
    avgCostAtSale: number;
    profit: number;
  }>;
};

type TurnParams = {
  variantId: string;
  minStockCadFrom: string;
  minStockCadTo: string;
  categoryId: string;
  from: string;
  to: string;
  take: string;
  showNoSale: boolean;
  useMinControl: boolean;
  useMaxControl: boolean;
  alertsOnly: boolean;
  maxStockCeiling: string;
  showPeakSalesPeriod: boolean;
};

function parseCadMinBound(raw: string): number | null {
  return parseProductCodeBound(raw);
}

function turnParamsFromSearchParams(sp: URLSearchParams): TurnParams {
  return {
    variantId: sp.get('variantId') ?? '',
    minStockCadFrom: sp.get('minStockCadFrom') ?? '',
    minStockCadTo: sp.get('minStockCadTo') ?? '',
    categoryId: sp.get('categoryId') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    take: sp.get('take') ?? '80',
    showNoSale: sp.get('showNoSale') !== '0',
    useMinControl: sp.get('useMinControl') !== '0',
    useMaxControl: sp.get('useMaxControl') === '1',
    alertsOnly: sp.get('alertsOnly') === '1',
    maxStockCeiling: sp.get('maxStockCeiling') ?? '',
    showPeakSalesPeriod: sp.get('showPeakSalesPeriod') === '1',
  };
}

export function ProductReportTurnoverPrintPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const backTo = productReportBackTo(searchParams);

  const params = useMemo(() => turnParamsFromSearchParams(searchParams), [searchParams]);

  const hasVariant = Boolean(params.variantId.trim());
  const cadFromN = parseCadMinBound(params.minStockCadFrom);
  const cadToN = parseCadMinBound(params.minStockCadTo);
  const cadOk =
    !hasVariant &&
    params.minStockCadFrom.trim() !== '' &&
    params.minStockCadTo.trim() !== '' &&
    cadFromN !== null &&
    cadToN !== null &&
    cadFromN <= cadToN;

  const qs = useMemo(
    () =>
      buildProductTurnoverReportQuery({
        from: params.from,
        to: params.to,
        take: params.take,
        variantId: hasVariant ? params.variantId : undefined,
        minStockCadFrom: cadOk ? params.minStockCadFrom : undefined,
        minStockCadTo: cadOk ? params.minStockCadTo : undefined,
        categoryId: params.categoryId || undefined,
        showNoSale: cadOk || hasVariant ? params.showNoSale : undefined,
        useMinControl: params.useMinControl,
        useMaxControl: params.useMaxControl,
        alertsOnly: params.alertsOnly,
        maxStockCeiling: params.maxStockCeiling,
        showPeakSalesPeriod: params.showPeakSalesPeriod,
      }),
    [params, hasVariant, cadOk],
  );

  const enabled = Boolean(params.from.trim() && params.to.trim());

  const report = useQuery({
    queryKey: ['reports', 'product-turnover-print', qs],
    queryFn: () => api<TurnoverResponse>(`/reports/product-turnover?${qs}`),
    enabled,
  });

  const data = report.data;

  useEffect(() => {
    if (enabled && report.data) window.scrollTo({ top: 0 });
  }, [enabled, report.data]);

  const headerExtras = data ? (
    <>
      <p className="print-sub">
        Período {data.period.from} a {data.period.to}
        {' · '}
        Top {params.take.trim() || '80'} por quantidade vendida (vendas concluídas)
        {data.categoryName ? ` · Categoria: ${data.categoryName}` : ''}
        {data.productCodeInterval
          ? ` · Código produto: ${data.productCodeInterval.from} a ${data.productCodeInterval.to}`
          : hasVariant
            ? ' · Uma variação (variantId)'
            : null}
        {data.options.alertsOnly ? ' · apenas linhas em alerta de estoque' : ''}
      </p>
      <p className="print-sub" style={{ marginTop: '0.2rem', fontSize: '0.88rem' }}>
        Controles: mín={data.options.useMinControl ? 'sim' : 'não'}
        {', '}máx=
        {data.options.useMaxControl ? `sim (teto ${data.options.maxStockCeiling ?? '—'})` : 'não'}
        {', '}somente alertas={data.options.alertsOnly ? 'sim' : 'não'}
        {data.productCodeInterval || hasVariant
          ? `, sem venda no período=${data.options.showNoSale ? 'incluir' : 'omitir'}`
          : ''}
        .
      </p>
    </>
  ) : enabled ? (
    <p className="print-sub">Carregando…</p>
  ) : null;

  const showStock = Boolean(data?.options.useMinControl || data?.options.useMaxControl);
  const showMinCol = Boolean(data?.options.useMinControl);
  const showBelow = Boolean(data?.options.useMinControl);
  const showAbove = Boolean(data?.options.useMaxControl);

  if (!enabled) {
    return (
      <div className="print-page">
        <p className="print-empty no-print">
          Parâmetros inválidos. Volte em Produtos, abra Relatórios e informe o período antes de gerar.
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
        <StandardReportHeader documentTitle="Giro de produtos" documentExtras={headerExtras} />

        {report.isLoading && <p>Carregando…</p>}
        {report.isError && (
          <div className="alert alert-error no-print">
            {(report.error as Error)?.message ?? 'Erro ao carregar relatório.'}
          </div>
        )}

        {data && (
          <>
            {data.options.showPeakSalesPeriod && data.peakSalesPeriod && (
              <p
                className="print-sub"
                style={{
                  margin: '0 0 0.75rem',
                  padding: '0.5rem 0.65rem',
                  background: 'var(--color-surface-muted, #f4f4f5)',
                  borderRadius: 6,
                  fontSize: '0.9rem',
                }}
              >
                <strong>Horário de maior movimento (vendas no período):</strong>{' '}
                {data.peakSalesPeriod.label} (horário de Manaus) —{' '}
                {data.peakSalesPeriod.movementQty.toLocaleString('pt-BR', {
                  maximumFractionDigits: 2,
                })}{' '}
                un. vendidas nessa faixa horária (soma de itens).
              </p>
            )}
            {data.options.showPeakSalesPeriod && !data.peakSalesPeriod && (
              <p className="print-sub" style={{ marginBottom: '0.75rem', fontSize: '0.88rem' }}>
                Sem vendas concluídas no período para calcular o horário de pico.
              </p>
            )}
            {!!data.methodology.trim() && (
              <p
                className="print-sub no-print"
                style={{ marginBottom: '0.75rem', fontSize: '0.82rem', lineHeight: 1.35 }}
              >
                {data.methodology}
              </p>
            )}
            {!data.lines.length ? (
              <p className="print-empty">
                Sem variantes neste relatório — verifique período ou o filtro de alertas de estoque.
              </p>
            ) : (
              <table className="print-table">
                <thead>
                  <tr>
                    <th className="num">Código</th>
                    <th>Produto</th>
                    <th>SKU</th>
                    {showMinCol ? <th className="num">Mín. cad.</th> : null}
                    {showStock ? <th className="num">Estoque atual</th> : null}
                    {showBelow ? <th>&lt; mín</th> : null}
                    {showAbove ? <th>&gt; teto</th> : null}
                    <th className="num">Qtd vendida</th>
                    <th className="num">Receita</th>
                    <th className="num">P. venda médio</th>
                    <th className="num">Custo médio (na venda)</th>
                    <th className="num">Lucro estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((r, idx) => (
                    <tr key={`${r.variantId}-${idx}`}>
                      <td className="num">{r.productControlNumber}</td>
                      <td>{r.productName}</td>
                      <td>{r.sku}</td>
                      {showMinCol ? (
                        <td className="num">
                          {r.minStock.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                        </td>
                      ) : null}
                      {showStock ? (
                        <td className="num">
                          {r.stockOnHand.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                        </td>
                      ) : null}
                      {showBelow ? <td>{r.belowMinStock ? 'Sim' : '—'}</td> : null}
                      {showAbove ? <td>{r.aboveMaxStock ? 'Sim' : '—'}</td> : null}
                      <td className="num">{r.qtySold.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
                      <td className="num">{formatBRL(r.revenue)}</td>
                      <td className="num">{formatBRL(r.avgSalePrice)}</td>
                      <td className="num">{formatBRL(r.avgCostAtSale)}</td>
                      <td className="num">{formatBRL(r.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <footer className="print-foot" style={{ marginTop: '1.25rem', fontSize: '0.82rem' }}>
              <span>GestorVend · Giro · valores para gestão; não substitui demonstrativos contábeis.</span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
