import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL, formatDate, formatStockQty } from '../lib/format';
import {
  buildProductStockReportQuery,
  productReportBackTo,
  productStockReportApiPath,
  productStockReportTitle,
  type ProductStockReportKind,
} from '../lib/product-report-format';
import './cash-print.css';

type StockParams = {
  from: string;
  to: string;
  locationId: string;
  categoryId: string;
  minStockCadFrom: string;
  minStockCadTo: string;
};

type FinancialLine = {
  sku: string;
  productName: string;
  categoryName: string | null;
  controlNumber: number;
  minStock: number;
  quantity: number;
  unitCost: number;
  unitRetailPrice: number;
  stockValue: number;
  unitProfit: number;
  profit: number;
};

type PhysicalLine = {
  sku: string;
  productName: string;
  categoryName: string | null;
  controlNumber: number;
  minStock: number;
  quantity: number;
  unitRetailPrice: number;
  saleValue: number;
};

type MinimumLine = {
  sku: string;
  productName: string;
  categoryName: string | null;
  controlNumber: number;
  minStock: number;
  quantity: number;
  deficit: number;
};

type StockReportResponse = {
  title: string;
  period: { from: string; to: string };
  asOfDate: string;
  locationId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  productCodeInterval: { from: number; to: number } | null;
  note: string;
  lines: FinancialLine[] | PhysicalLine[] | MinimumLine[];
  totals: Record<string, number>;
};

function kindFromPath(pathname: string): ProductStockReportKind {
  if (pathname.includes('estoque-fisico')) return 'physical';
  if (pathname.includes('estoque-minimo')) return 'minimum';
  return 'financial';
}

function stockParamsFromSearchParams(sp: URLSearchParams): StockParams {
  return {
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    locationId: sp.get('locationId') ?? '',
    categoryId: sp.get('categoryId') ?? '',
    minStockCadFrom: sp.get('minStockCadFrom') ?? '',
    minStockCadTo: sp.get('minStockCadTo') ?? '',
  };
}

export function ProductReportStockPrintPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const kind = kindFromPath(location.pathname);
  const [searchParams] = useSearchParams();
  const backTo = productReportBackTo(searchParams);

  const params = useMemo(() => stockParamsFromSearchParams(searchParams), [searchParams]);

  const qs = useMemo(
    () =>
      buildProductStockReportQuery({
        from: params.from,
        to: params.to,
        locationId: params.locationId || undefined,
        categoryId: params.categoryId || undefined,
        minStockCadFrom: params.minStockCadFrom || undefined,
        minStockCadTo: params.minStockCadTo || undefined,
      }),
    [params],
  );

  const enabled = Boolean(params.from && params.to);

  const report = useQuery({
    queryKey: ['reports', kind, 'stock-print', qs],
    queryFn: () => api<StockReportResponse>(`${productStockReportApiPath(kind)}?${qs}`),
    enabled,
  });

  const data = report.data;
  const title = productStockReportTitle(kind);

  useEffect(() => {
    if (enabled && report.data) window.scrollTo({ top: 0 });
  }, [enabled, report.data]);

  const filterSummary = data ? (
    <>
      <p className="print-sub">
        Período: <strong>{formatDate(data.period.from)}</strong> a <strong>{formatDate(data.period.to)}</strong>
        {' · '}
        Posição na data final ({formatDate(data.asOfDate)}).
        {data.locationId ? <> · Local: filtrado nos parâmetros</> : <> · Local: todos</>}
        {data.categoryName ? (
          <>
            {' · '}
            Categoria: <strong>{data.categoryName}</strong>
          </>
        ) : (
          <> · Categoria: todas</>
        )}
        {data.productCodeInterval ? (
          <>
            {' · '}
            Código: {data.productCodeInterval.from} – {data.productCodeInterval.to}
          </>
        ) : (
          <> · Código: todos</>
        )}
      </p>
      <p className="print-sub" style={{ fontSize: '0.82rem' }}>
        {data.note}
      </p>
    </>
  ) : enabled ? (
    <p className="print-sub">Carregando…</p>
  ) : null;

  if (!enabled) {
    return (
      <div className="print-page">
        <p className="print-empty no-print">
          Parâmetros inválidos. Volte em Produtos, abra Relatórios e informe as datas antes de gerar.
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
        <StandardReportHeader documentTitle={title} documentExtras={filterSummary} />

        {report.isLoading && <p>Carregando…</p>}
        {report.isError && (
          <div className="alert alert-error no-print">{(report.error as Error).message}</div>
        )}

        {kind === 'financial' && data && (
          <div className="table-wrap">
            <table className="data-table print-table-compact">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th className="num">Código</th>
                  <th className="num">Qtd.</th>
                  <th className="num">Preço venda</th>
                  <th className="num">Custo unit.</th>
                  <th className="num">Valor estoque</th>
                  <th className="num">Lucro pot.</th>
                </tr>
              </thead>
              <tbody>
                {!data.lines.length && (
                  <tr>
                    <td colSpan={9} className="empty">
                      Nenhum produto no conjunto filtrado.
                    </td>
                  </tr>
                )}
                {(data.lines as FinancialLine[]).map((row, idx) => (
                  <tr key={`${row.sku}-${idx}`}>
                    <td>{row.sku}</td>
                    <td>{row.productName}</td>
                    <td>{row.categoryName ?? '—'}</td>
                    <td className="num">{row.controlNumber}</td>
                    <td className="num">{formatStockQty(String(row.quantity))}</td>
                    <td className="num">{formatBRL(row.unitRetailPrice)}</td>
                    <td className="num">{formatBRL(row.unitCost)}</td>
                    <td className="num">{formatBRL(row.stockValue)}</td>
                    <td className="num">{formatBRL(row.profit)}</td>
                  </tr>
                ))}
              </tbody>
              {!!data.lines.length && (
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={4}>Total geral</td>
                    <td className="num">{formatStockQty(String(data.totals.quantity ?? 0))}</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">{formatBRL(data.totals.stockValue ?? 0)}</td>
                    <td className="num">{formatBRL(data.totals.profit ?? 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {kind === 'physical' && data && (
          <div className="table-wrap">
            <table className="data-table print-table-compact">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th className="num">Código</th>
                  <th className="num">Qtd.</th>
                  <th className="num">Preço venda</th>
                  <th className="num">Valor (qtd × preço)</th>
                </tr>
              </thead>
              <tbody>
                {!data.lines.length && (
                  <tr>
                    <td colSpan={7} className="empty">
                      Nenhum produto no conjunto filtrado.
                    </td>
                  </tr>
                )}
                {(data.lines as PhysicalLine[]).map((row, idx) => (
                  <tr key={`${row.sku}-${idx}`}>
                    <td>{row.sku}</td>
                    <td>{row.productName}</td>
                    <td>{row.categoryName ?? '—'}</td>
                    <td className="num">{row.controlNumber}</td>
                    <td className="num">{formatStockQty(String(row.quantity))}</td>
                    <td className="num">{formatBRL(row.unitRetailPrice)}</td>
                    <td className="num">{formatBRL(row.saleValue)}</td>
                  </tr>
                ))}
              </tbody>
              {!!data.lines.length && (
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={4}>Total geral</td>
                    <td className="num">{formatStockQty(String(data.totals.quantity ?? 0))}</td>
                    <td className="num">—</td>
                    <td className="num">{formatBRL(data.totals.saleValue ?? 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {kind === 'minimum' && data && (
          <div className="table-wrap">
            <table className="data-table print-table-compact">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th className="num">Código</th>
                  <th className="num">Mínimo SKU</th>
                  <th className="num">Qtd. atual</th>
                  <th className="num">Déficit</th>
                </tr>
              </thead>
              <tbody>
                {!data.lines.length && (
                  <tr>
                    <td colSpan={7} className="empty">
                      Nenhuma variação no ou abaixo do estoque mínimo para os filtros informados.
                    </td>
                  </tr>
                )}
                {(data.lines as MinimumLine[]).map((row, idx) => (
                  <tr key={`${row.sku}-${idx}`}>
                    <td>{row.sku}</td>
                    <td>{row.productName}</td>
                    <td>{row.categoryName ?? '—'}</td>
                    <td className="num">{row.controlNumber}</td>
                    <td className="num">{formatStockQty(String(row.minStock))}</td>
                    <td className="num">{formatStockQty(String(row.quantity))}</td>
                    <td className="num">{formatStockQty(String(row.deficit))}</td>
                  </tr>
                ))}
              </tbody>
              {!!data.lines.length && (
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={4}>Total</td>
                    <td className="num">{data.totals.linesCount ?? 0} item(ns)</td>
                    <td className="num">—</td>
                    <td className="num">{formatStockQty(String(data.totals.totalDeficit ?? 0))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
