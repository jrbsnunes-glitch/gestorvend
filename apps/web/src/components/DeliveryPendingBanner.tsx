import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { hasDeliveryModule, hasRestaurantPlan } from '../lib/auth';

export function DeliveryPendingBanner() {
  const ok = hasRestaurantPlan() && hasDeliveryModule();
  const q = useQuery({
    queryKey: ['restaurant', 'delivery-pending'],
    queryFn: () => api<{ count: number }>('/restaurant/delivery/pending-count'),
    enabled: ok,
    refetchInterval: 10_000,
    retry: false,
  });
  if (!ok || q.isError || !q.data?.count) return null;
  return (
    <div className="pos-stale-cash-banner no-print" role="status">
      <span>
        {q.data.count} pedido{q.data.count > 1 ? 's' : ''} delivery aceito(s) — iniciar preparo.{' '}
        <Link to="/salao">Abrir salão</Link>
      </span>
    </div>
  );
}
