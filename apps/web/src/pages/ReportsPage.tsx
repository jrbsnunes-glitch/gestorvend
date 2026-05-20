import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getToken } from '../lib/api';
import { formatBRL } from '../lib/format';
import { buildStockPositionReportQuery } from '../lib/stock-report-format';

type SalesSummary = { count: number; total: number; sales: Array<{ number: number; total: string; status: string }> };

type StockPositionPayload = {
  options: {
    useMinControl: boolean;
    useMaxControl: boolean;
    maxStockCeiling: number | null;
    alertsOnly: boolean;
  };
  note: string;
  rows: Array<{
    quantity: string;
    variantId: string;
    variant: { sku: string; product: { name: string; inventoryControlMin?: string } };
    location: { code: string };
    minStock: number;
    stockOnHandTotal: number;
    belowMinStock: boolean;
    aboveMaxStock: boolean;
  }>;
};

const filterWrap: CSSProperties = {
  marginBottom: '1rem',
  padding: '0.85rem 1rem',
  background: '#f8fafc',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
};

export function ReportsPage() {
  const sales = useQuery({
    queryKey: ['reports', 'sales-summary'],
    queryFn: () => api<SalesSummary>('/reports/sales-summary'),
  });

  const [stkUseMin, setStkUseMin] = useState(false);
  const [stkUseMax, setStkUseMax] = useState(false);
  const [stkAlertsOnly, setStkAlertsOnly] = useState(false);
  const [stkCeiling, setStkCeiling] = useState('');

  const stkClientErr = useMemo(() => {
    if (stkUseMax && !stkCeiling.trim()) {
      return 'Informe o teto de estoque para usar o controle máximo.';
    }
    if (stkAlertsOnly && !stkUseMin && !(stkUseMax && stkCeiling.trim())) {
      return 'Para “somente alertas”, ative o mínimo e/ou o máximo com teto informado.';
    }
    return null;
  }, [stkUseMax, stkCeiling, stkAlertsOnly, stkUseMin]);

  const stkQs = useMemo(
    () =>
      buildStockPositionReportQuery({
        useMinControl: stkUseMin,
        useMaxControl: stkUseMax,
        alertsOnly: stkAlertsOnly,
        maxStockCeiling: stkCeiling,
      }),
    [stkUseMin, stkUseMax, stkAlertsOnly, stkCeiling],
  );

  const stock = useQuery({
    queryKey: ['reports', 'stock-position', stkQs],
    queryFn: () => api<StockPositionPayload>(`/reports/stock-position?${stkQs}`),
    enabled: stkClientErr == null,
  });

  async function downloadCsv() {
    const t = getToken();
    const res = await fetch('/api/reports/export/sales.csv', {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Falha ao exportar');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onExportClick() {
    try {
      await downloadCsv();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro na exportação');
    }
  }

  const opts = stock.data?.options;
  const showMinCol = Boolean(opts?.useMinControl);
  const showTotalCol = Boolean(opts?.useMinControl || opts?.useMaxControl);
  const showBelowCol = Boolean(opts?.useMinControl);
  const showAboveCol = Boolean(opts?.useMaxControl);
  const stockTableColSpan = 5 + (showMinCol ? 1 : 0) + (showTotalCol ? 1 : 0) + (showBelowCol ? 1 : 0) + (showAboveCol ? 1 : 0);

  return (
    <div className="page">
      <h1 className="page-title">Relatórios</h1>
      <p className="page-desc">
        Resumos e exportação CSV. Os downloads usam o token do navegador ao abrir em nova aba; se falhar, use a API autenticada.
      </p>

      <div className="card">
        <h2 className="page-title" style={{ fontSize: '1.05rem' }}>
          Vendas
        </h2>
        {sales.isError && <div className="alert alert-error">{(sales.error as Error).message}</div>}
        {sales.isLoading && <p className="muted">Carregando…</p>}
        {sales.data && (
          <>
            <div className="stat-grid" style={{ marginBottom: '1rem' }}>
              <div className="stat-card">
                <div className="label">Qtde. vendas</div>
                <div className="value">{sales.data.count}</div>
              </div>
              <div className="stat-card">
                <div className="label">Total</div>
                <div className="value" style={{ fontSize: '1.2rem' }}>
                  {formatBRL(sales.data.total)}
                </div>
              </div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void onExportClick()}>
              Exportar vendas (.csv)
            </button>
            <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              O arquivo é gerado com seu token de acesso (autenticado).
            </p>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>
          Posição de estoque
        </h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
          Lista saldos por local. Controles comparam o{' '}
          <strong>estoque total da variação</strong> (soma nos locais) com o mínimo cadastrado e/ou com um teto que você definir.
        </p>

        <div style={filterWrap}>
          {stkClientErr && <div className="alert alert-error">{stkClientErr}</div>}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={stkUseMax} onChange={(e) => setStkUseMax(e.target.checked)} />
            Controle por teto máximo
          </label>
          <div className="field" style={{ maxWidth: '200px', marginTop: '0.35rem' }}>
            <label htmlFor="rpt-stk-max">Teto (estoque máximo por variante)</label>
            <input
              id="rpt-stk-max"
              inputMode="decimal"
              placeholder="—"
              disabled={!stkUseMax}
              value={stkCeiling}
              onChange={(e) => setStkCeiling(e.target.value)}
            />
          </div>
          <div style={{ marginTop: '0.65rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.85rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="checkbox" checked={stkUseMin} onChange={(e) => setStkUseMin(e.target.checked)} />
              Usar estoque mínimo cadastrado
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="checkbox" checked={stkAlertsOnly} onChange={(e) => setStkAlertsOnly(e.target.checked)} />
              Só itens em alerta
            </label>
          </div>
        </div>

        {!stkClientErr && stock.isError && (
          <div className="alert alert-error">{(stock.error as Error).message}</div>
        )}
        {stkClientErr ? (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Ajuste os filtros acima para atualizar a tabela.
          </p>
        ) : stock.data?.note ? (
          <p className="page-desc" style={{ marginBottom: '0.75rem', fontSize: '0.82rem' }}>
            {stock.data.note}
          </p>
        ) : null}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">Ctr. prod.</th>
                <th>SKU</th>
                <th>Produto</th>
                <th>Local</th>
                {showMinCol ? <th className="num">Mín. cad.</th> : null}
                {showTotalCol ? <th className="num">Total variante</th> : null}
                <th className="num">Qtd neste local</th>
                {showBelowCol ? <th>&lt; mín</th> : null}
                {showAboveCol ? <th>&gt; teto</th> : null}
              </tr>
            </thead>
            <tbody>
              {stkClientErr ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Corrija os filtros de controle para carregar os saldos.
                  </td>
                </tr>
              ) : stock.isPending ? (
                <tr>
                  <td colSpan={5} className="empty muted">
                    Carregando…
                  </td>
                </tr>
              ) : !stock.data?.rows?.length ? (
                <tr>
                  <td colSpan={stockTableColSpan || 4} className="empty">
                    Sem saldos (cadastre produtos e movimente estoque) ou nenhuma linha com os filtros de alerta.
                  </td>
                </tr>
              ) : (
                stock.data.rows.map((row, i) => (
                  <tr key={`${row.variantId}-${row.location.code}-${i}`}>
                    <td className="num">
                      {Number(row.variant.product.inventoryControlMin ?? 1).toLocaleString('pt-BR', {
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td>
                      <strong>{row.variant.sku}</strong>
                    </td>
                    <td>{row.variant.product.name}</td>
                    <td>{row.location.code}</td>
                    {showMinCol ? <td className="num">{String(row.minStock)}</td> : null}
                    {showTotalCol ? <td className="num">{String(row.stockOnHandTotal)}</td> : null}
                    <td className="num">{row.quantity}</td>
                    {showBelowCol ? <td>{row.belowMinStock ? 'Sim' : '—'}</td> : null}
                    {showAboveCol ? <td>{row.aboveMaxStock ? 'Sim' : '—'}</td> : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
