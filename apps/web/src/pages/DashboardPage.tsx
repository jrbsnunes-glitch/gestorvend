import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';

type Health = { status: string; service: string };

type SalesSummary = { count: number; total: number };

export function DashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    staleTime: 30_000,
  });

  const sales = useQuery({
    queryKey: ['reports', 'sales-summary'],
    queryFn: () => api<SalesSummary>('/reports/sales-summary'),
  });

  return (
    <div className="page">
      <h1 className="page-title">Início</h1>
      <p className="page-desc">
        Visão geral do ambiente. Use o menu para cadastros, estoque, vendas e financeiro.
      </p>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">API</div>
          <div className="value" style={{ fontSize: '1rem' }}>
            {health.isLoading ? '…' : health.data?.status === 'ok' ? 'Conectada' : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Vendas (período atual)</div>
          <div className="value">
            {sales.isLoading ? '…' : sales.data != null ? sales.data.count : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Faturamento</div>
          <div className="value" style={{ fontSize: '1.15rem' }}>
            {sales.isLoading ? '…' : formatBRL(sales.data?.total)}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
          Status do serviço
        </h2>
        {health.isError && (
          <div className="alert alert-error">Não foi possível contatar a API.</div>
        )}
        {health.data && (
          <pre style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            {JSON.stringify(health.data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
