import { useQuery } from '@tanstack/react-query';
import { api, getToken } from '../lib/api';
import { formatBRL } from '../lib/format';
type SalesSummary = { count: number; total: number; sales: Array<{ number: number; total: string; status: string }> };

export function ReportsPage() {
  const sales = useQuery({
    queryKey: ['reports', 'sales-summary'],
    queryFn: () => api<SalesSummary>('/reports/sales-summary'),
  });

  const stock = useQuery({
    queryKey: ['reports', 'stock-position'],
    queryFn: () =>
      api<Array<{ quantity: string; variant: { sku: string; product: { name: string } }; location: { code: string } }>>(
        '/reports/stock-position',
      ),
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
  return (
    <div className="page">
      <h1 className="page-title">Relatórios</h1>
      <p className="page-desc">Resumos e exportação CSV. Os downloads usam o token do navegador ao abrir em nova aba; se falhar, use a API autenticada.</p>

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
            </p>          </>
        )}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>
          Posição de estoque
        </h2>
        {stock.isError && <div className="alert alert-error">{(stock.error as Error).message}</div>}
        {stock.isLoading && <p className="muted">Carregando…</p>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Produto</th>
                <th>Local</th>
                <th>Qtd</th>
              </tr>
            </thead>
            <tbody>
              {!stock.isLoading && !stock.data?.length && (
                <tr>
                  <td colSpan={4} className="empty">
                    Sem saldos (cadastre produtos e movimente estoque).
                  </td>
                </tr>
              )}
              {stock.data?.map((row, i) => (
                <tr key={i}>
                  <td>
                    <strong>{row.variant.sku}</strong>
                  </td>
                  <td>{row.variant.product.name}</td>
                  <td>{row.location.code}</td>
                  <td>{row.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
