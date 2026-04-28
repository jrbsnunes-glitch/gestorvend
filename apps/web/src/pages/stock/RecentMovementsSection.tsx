import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

type Mov = {
  id: string;
  type: string;
  source: string;
  quantity: string;
  createdAt: string;
  variant: { sku: string; product: { name: string } };
  location: { code: string; name: string };
};

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    GOODS_RECEIPT: 'Entrada / NF',
    SALE: 'Venda',
    MANUAL_OUT: 'Saída manual',
    ADJUSTMENT: 'Ajuste',
    OTHER: 'Outras',
    TRANSFER: 'Transferência',
  };
  return map[source] ?? source;
}

export function RecentMovementsSection({
  take = 15,
  filterSource,
}: {
  take?: number;
  /** Se definido, chama a API com ?source= */
  filterSource?: 'MANUAL_OUT' | 'GOODS_RECEIPT' | 'SALE' | 'ADJUSTMENT' | 'OTHER';
}) {
  const q = useQuery({
    queryKey: ['stock-movements', 'recent-section', take, filterSource ?? 'all'],
    queryFn: () =>
      api<Mov[]>(
        `/stock-movements?take=${take}${filterSource ? `&source=${encodeURIComponent(filterSource)}` : ''}`,
      ),
  });

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
        Últimos lançamentos
      </h2>
      {q.isError && <div className="alert alert-error">{(q.error as Error).message}</div>}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Origem</th>
              <th>Produto</th>
              <th>Local</th>
              <th>Qtd</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={6} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!q.isLoading && !q.data?.length && (
              <tr>
                <td colSpan={6} className="empty">
                  Nenhum lançamento ainda.
                </td>
              </tr>
            )}
            {q.data?.map((m) => (
              <tr key={m.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                  {new Date(m.createdAt).toLocaleString('pt-BR')}
                </td>
                <td>
                  <span className="badge badge-muted">{m.type}</span>
                </td>
                <td style={{ fontSize: '0.85rem' }}>{sourceLabel(m.source)}</td>
                <td>
                  <strong>{m.variant.product.name}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{m.variant.sku}</div>
                </td>
                <td style={{ fontSize: '0.85rem' }}>
                  {m.location.code}
                </td>
                <td>{m.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
