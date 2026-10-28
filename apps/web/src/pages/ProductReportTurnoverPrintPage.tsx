import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { A4ReportPages, type A4Item } from '../components/A4ReportPages';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { PrintActions } from '../components/PrintActions';
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

  const reportItems = useMemo((): A4Item[] => {
    if (report.isError) {
      return [{ kind: 'block', key: 'error', node: <p>Não foi possível montar o relatório.</p> }];
    }
    if (!data) return [{ kind: 'block', key: 'loading', node: <p>Carregando…</p> }];
    const items: A4Item[] = [];
    if (data.options.showPeakSalesPeriod && data.peakSalesPeriod) {
      items.push({
        kind: 'block',
        key: 'peak',
        node: (
          <p className="print-sub" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
            <strong>Horário de maior movimento (vendas no período):</strong> {data.peakSalesPeriod.label}{' '}
            (horário de Manaus) —{' '}
            {data.peakSalesPeriod.movementQty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un.
            vendidas nessa faixa horária (soma de itens).
          </p>
        ),
      });
    } else if (data.options.showPeakSalesPeriod) {
      items.push({
        kind: 'block',
        key: 'peak-empty',
        node: (
          <p className="print-sub" style={{ marginBottom: '0.75rem', fontSize: '0.88rem' }}>
            Sem vendas concluídas no período para calcular o horário de pico.
          </p>
        ),
      });
    }
    items.push({
      kind: 'table',
      key: 'lines',
      tableClassName: 'print-table',
      head: (
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
      ),
      rows: data.lines.map((r, idx) => (
        <tr key={`${r.variantId}-${idx}`}>
          <td className="num">{r.productControlNumber}</td>
          <td>{r.productName}</td>
          <td>{r.sku}</td>
          {showMinCol ? (
            <td className="num">{r.minStock.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
          ) : null}
          {showStock ? (
            <td className="num">{r.stockOnHand.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
          ) : null}
          {showBelow ? <td>{r.belowMinStock ? 'Sim' : '—'}</td> : null}
          {showAbove ? <td>{r.aboveMaxStock ? 'Sim' : '—'}</td> : null}
          <td className="num">{r.qtySold.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
          <td className="num">{formatBRL(r.revenue)}</td>
          <td className="num">{formatBRL(r.avgSalePrice)}</td>
          <td className="num">{formatBRL(r.avgCostAtSale)}</td>
          <td className="num">{formatBRL(r.profit)}</td>
        </tr>
      )),
      empty: (
        <tr>
          <td colSpan={12} className="empty">
            Sem variantes neste relatório — verifique período ou o filtro de alertas de estoque.
          </td>
        </tr>
      ),
    });
    items.push({
      kind: 'block',
      key: 'note',
      node: (
        <p className="print-foot" style={{ marginTop: '0.35rem', fontSize: '0.82rem' }}>
          GestorVend · Giro · valores para gestão; não substitui demonstrativos contábeis.
        </p>
      ),
    });
    return items;
  }, [data, report.isError, showAbove, showBelow, showMinCol, showStock]);

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
        <PrintActions />
      </div>

      {report.isError && (
        <div className="alert alert-error no-print" style={{ width: '210mm', maxWidth: '100%', margin: '0 auto 0.75rem' }}>
          {(report.error as Error)?.message ?? 'Erro ao carregar relatório.'}
        </div>
      )}
      {!!data?.methodology.trim() && (
        <p
          className="print-sub no-print"
          style={{ width: '210mm', maxWidth: '100%', margin: '0 auto 0.75rem', fontSize: '0.82rem', lineHeight: 1.35 }}
        >
          {data.methodology}
        </p>
      )}

      <A4ReportPages
        header={<StandardReportHeader documentTitle="Giro de produtos" documentExtras={headerExtras} />}
        items={reportItems}
        layoutKey={`turnover:${report.status}:${data?.lines.length ?? 0}:${showMinCol}:${showStock}:${showBelow}:${showAbove}`}
      />
    </div>
  );
}
