import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL, formatDate, formatStockQty } from '../lib/format';
import {
  buildProductStockReportQuery,
  productStockReportApiPath,
  productStockReportTitle,
  type ProductStockReportKind,
} from '../lib/product-report-format';
import './cash-print.css';

type StockFilters = {
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
  inventoryControlMin: number;
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
  inventoryControlMin: number;
  minStock: number;
  quantity: number;
  unitRetailPrice: number;
  saleValue: number;
};

type MinimumLine = {
  sku: string;
  productName: string;
  categoryName: string | null;
  inventoryControlMin: number;
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
  cadastroMinStockInterval: { from: number; to: number } | null;
  note: string;
  lines: FinancialLine[] | PhysicalLine[] | MinimumLine[];
  totals: Record<string, number>;
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

function kindFromPath(pathname: string): ProductStockReportKind {
  if (pathname.includes('estoque-fisico')) return 'physical';
  if (pathname.includes('estoque-minimo')) return 'minimum';
  return 'financial';
}

function draftFromSearchParams(sp: URLSearchParams): StockFilters {
  return {
    from: sp.get('from') ?? monthStartISO(),
    to: sp.get('to') ?? todayISO(),
    locationId: sp.get('locationId') ?? '',
    categoryId: sp.get('categoryId') ?? '',
    minStockCadFrom: sp.get('minStockCadFrom') ?? '',
    minStockCadTo: sp.get('minStockCadTo') ?? '',
  };
}

function parseCadMinBound(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function ProductReportStockPrintPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const kind = kindFromPath(location.pathname);
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<StockFilters>(() => draftFromSearchParams(searchParams));
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const spKey = searchParams.toString();
  useEffect(() => {
    setDraft(draftFromSearchParams(searchParams));
  }, [spKey]);

  const qs = useMemo(
    () =>
      buildProductStockReportQuery({
        from: draft.from,
        to: draft.to,
        locationId: draft.locationId || undefined,
        categoryId: draft.categoryId || undefined,
        minStockCadFrom: draft.minStockCadFrom || undefined,
        minStockCadTo: draft.minStockCadTo || undefined,
      }),
    [draft],
  );

  const enabled = Boolean(draft.from && draft.to);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const categories = useQuery({
    queryKey: ['categories', 'report-stock'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/categories?q='),
  });

  const report = useQuery({
    queryKey: ['reports', kind, 'stock-print', qs],
    queryFn: () => api<StockReportResponse>(`${productStockReportApiPath(kind)}?${qs}`),
    enabled,
  });

  const data = report.data;
  const title = productStockReportTitle(kind);

  function applyFilters() {
    setApplyErr(null);
    if (!draft.from.trim() || !draft.to.trim()) {
      setApplyErr('Informe as datas inicial e final.');
      return;
    }
    const hasFrom = draft.minStockCadFrom.trim() !== '';
    const hasTo = draft.minStockCadTo.trim() !== '';
    if (hasFrom !== hasTo) {
      setApplyErr('Informe ambos os campos de controle (de / até) ou deixe os dois em branco.');
      return;
    }
    if (hasFrom && hasTo) {
      const a = parseCadMinBound(draft.minStockCadFrom);
      const b = parseCadMinBound(draft.minStockCadTo);
      if (a === null || b === null) {
        setApplyErr('Intervalo de controle inválido.');
        return;
      }
      if (a > b) {
        setApplyErr('Controle “de” não pode ser maior que “até”.');
        return;
      }
    }
    setSearchParams(
      new URLSearchParams(
        buildProductStockReportQuery({
          from: draft.from,
          to: draft.to,
          locationId: draft.locationId || undefined,
          categoryId: draft.categoryId || undefined,
          minStockCadFrom: draft.minStockCadFrom || undefined,
          minStockCadTo: draft.minStockCadTo || undefined,
        }),
      ),
      { replace: true },
    );
  }

  const filterSummary = data ? (
    <>
      <p className="print-sub">
        Período: <strong>{formatDate(data.period.from)}</strong> a <strong>{formatDate(data.period.to)}</strong>
        {' · '}
        Posição na data final ({formatDate(data.asOfDate)}).
        {data.locationId ? (
          <>
            {' · '}
            Local:{' '}
            <strong>
              {locations.data?.find((l) => l.id === data.locationId)?.code ?? data.locationId}
            </strong>
          </>
        ) : (
          <> · Local: todos</>
        )}
        {data.categoryName ? (
          <>
            {' · '}
            Grupo: <strong>{data.categoryName}</strong>
          </>
        ) : (
          <> · Grupo: todos</>
        )}
        {data.cadastroMinStockInterval ? (
          <>
            {' · '}
            Controle: {data.cadastroMinStockInterval.from} – {data.cadastroMinStockInterval.to}
          </>
        ) : (
          <> · Controle: todos</>
        )}
      </p>
      <p className="print-sub" style={{ fontSize: '0.82rem' }}>
        {data.note}
      </p>
    </>
  ) : enabled ? (
    <p className="print-sub">Carregando…</p>
  ) : (
    <p className="print-sub">
      Ajuste os filtros abaixo e clique em <strong>Atualizar relatório</strong>.
    </p>
  );

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
        }}
      >
        <div className="pm-move-filters__title">Filtros — {title}</div>
        {applyErr && <div className="alert alert-error pm-move-filters__alert">{applyErr}</div>}
        <div className="pm-move-filters__row">
          <div className="pm-move-filters__cadgroup" aria-label="Intervalo controle cadastro produto">
            <span className="pm-move-filters__muted-label">Controle</span>
            <div className="field pm-move-filters__tinyfield">
              <label htmlFor="ps-cfrom">De</label>
              <input
                id="ps-cfrom"
                inputMode="decimal"
                placeholder="opc."
                value={draft.minStockCadFrom}
                onChange={(e) => setDraft((d) => ({ ...d, minStockCadFrom: e.target.value }))}
                style={{ width: '5rem' }}
              />
            </div>
            <div className="field pm-move-filters__tinyfield">
              <label htmlFor="ps-cto">Até</label>
              <input
                id="ps-cto"
                inputMode="decimal"
                placeholder="opc."
                value={draft.minStockCadTo}
                onChange={(e) => setDraft((d) => ({ ...d, minStockCadTo: e.target.value }))}
                style={{ width: '5rem' }}
              />
            </div>
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="ps-cat">Grupo</label>
            <select
              id="ps-cat"
              value={draft.categoryId}
              onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))}
            >
              <option value="">Todos</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="ps-loc">Local</label>
            <select
              id="ps-loc"
              value={draft.locationId}
              onChange={(e) => setDraft((d) => ({ ...d, locationId: e.target.value }))}
            >
              <option value="">Todos</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </select>
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="ps-from">Data inicial</label>
            <input
              id="ps-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="ps-to">Data final</label>
            <input
              id="ps-to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={applyFilters}>
            Atualizar relatório
          </button>
        </div>
      </div>

      <StandardReportHeader documentTitle={title} documentExtras={filterSummary} />

      {report.isError && (
        <div className="alert alert-error no-print">{(report.error as Error).message}</div>
      )}

      {kind === 'financial' && data && (
        <>
          <div className="table-wrap">
            <table className="data-table print-table-compact">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Grupo</th>
                  <th className="num">Controle</th>
                  <th className="num">Qtd.</th>
                  <th className="num">Custo unit.</th>
                  <th className="num">Valor estoque</th>
                  <th className="num">Lucro pot.</th>
                </tr>
              </thead>
              <tbody>
                {!data.lines.length && (
                  <tr>
                    <td colSpan={8} className="empty">
                      Nenhum produto no conjunto filtrado.
                    </td>
                  </tr>
                )}
                {(data.lines as FinancialLine[]).map((row, idx) => (
                  <tr key={`${row.sku}-${idx}`}>
                    <td>{row.sku}</td>
                    <td>{row.productName}</td>
                    <td>{row.categoryName ?? '—'}</td>
                    <td className="num">{formatStockQty(String(row.inventoryControlMin))}</td>
                    <td className="num">{formatStockQty(String(row.quantity))}</td>
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
                    <td className="num">{formatBRL(data.totals.stockValue ?? 0)}</td>
                    <td className="num">{formatBRL(data.totals.profit ?? 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {kind === 'physical' && data && (
        <>
          <div className="table-wrap">
            <table className="data-table print-table-compact">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Grupo</th>
                  <th className="num">Controle</th>
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
                    <td className="num">{formatStockQty(String(row.inventoryControlMin))}</td>
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
        </>
      )}

      {kind === 'minimum' && data && (
        <>
          <div className="table-wrap">
            <table className="data-table print-table-compact">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Grupo</th>
                  <th className="num">Controle</th>
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
                    <td className="num">{formatStockQty(String(row.inventoryControlMin))}</td>
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
        </>
      )}
    </div>
  );
}
