import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { hasDeliveryModule, hasRestaurantPlan } from '../../lib/auth';
import { formatBRL } from '../../lib/format';

type DeliveryTab = {
  id: string;
  number: number;
  fulfillment: 'DELIVERY' | 'PICKUP' | string;
  deliveryStatus: string | null;
  deliveryPrintStatus: string | null;
  paymentMode: string | null;
  deliveryAddress: string | null;
  deliveryPhone: string | null;
  deliveryFeeAmount: string | number;
  customer?: { name: string } | null;
  items: Array<{
    totalLine: string | number;
    quantity: string | number;
    variant?: { product?: { name?: string } };
  }>;
};

function statusLabel(s: string | null): string {
  switch (s) {
    case 'AWAITING_PAYMENT':
      return 'Aguardando PIX';
    case 'RECEIVED':
      return 'Recebido';
    case 'PREPARING':
      return 'Preparo';
    case 'OUT_FOR_DELIVERY':
      return 'Saiu';
    case 'READY_PICKUP':
      return 'Pronto (retirada)';
    case 'COMPLETED':
      return 'Concluído';
    default:
      return s ?? '—';
  }
}

export function DeliveryOrdersPanel() {
  const qc = useQueryClient();
  const ok = hasRestaurantPlan() && hasDeliveryModule();
  const q = useQuery({
    queryKey: ['restaurant', 'delivery-orders'],
    queryFn: () => api<DeliveryTab[]>('/restaurant/delivery/orders'),
    enabled: ok,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? false : 8_000,
  });

  const kitchen = useMutation({
    mutationFn: (id: string) =>
      api(`/restaurant/delivery/orders/${id}/kitchen-print`, { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['restaurant', 'delivery-orders'] }),
  });
  const statusMut = useMutation({
    mutationFn: (p: { id: string; status: 'OUT_FOR_DELIVERY' | 'READY_PICKUP' | 'PREPARING' }) =>
      api(`/restaurant/delivery/orders/${p.id}/status`, { method: 'PATCH', json: { status: p.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['restaurant', 'delivery-orders'] }),
  });

  if (!ok) return null;
  if (q.isError) return null;

  const rows = q.data ?? [];
  const pending = rows.filter((t) => t.deliveryPrintStatus === 'PENDING_COUNTER').length;

  return (
    <section className="restaurant-delivery-panel" aria-label="Pedidos delivery">
      <div className="restaurant-delivery-panel__head">
        <h2>Pedidos delivery / retirada</h2>
        {pending > 0 ? (
          <span className="restaurant-delivery-badge">{pending} aguardando cozinha</span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="muted">Nenhum pedido aberto no canal delivery.</p>
      ) : (
        <ul className="restaurant-delivery-list">
          {rows.map((t) => {
            const total =
              t.items.reduce((s, i) => s + Number(i.totalLine), 0) + Number(t.deliveryFeeAmount ?? 0);
            return (
              <li key={t.id} className="restaurant-delivery-card">
                <div>
                  <strong>
                    #{t.number} · {t.fulfillment === 'PICKUP' ? 'Retirada' : 'Entrega'}
                  </strong>
                  <div className="muted">
                    {t.customer?.name ?? 'Cliente'} {t.deliveryPhone ? `· ${t.deliveryPhone}` : ''}
                  </div>
                  {t.deliveryAddress ? <div className="muted">{t.deliveryAddress}</div> : null}
                  <div className="muted">{statusLabel(t.deliveryStatus)}</div>
                  <div>{formatBRL(total)}</div>
                </div>
                <div className="restaurant-delivery-card__actions">
                  {t.deliveryPrintStatus === 'PENDING_COUNTER' &&
                  t.deliveryStatus !== 'AWAITING_PAYMENT' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={kitchen.isPending}
                      onClick={() => kitchen.mutate(t.id)}
                    >
                      Enviar à cozinha
                    </button>
                  ) : null}
                  {t.fulfillment === 'DELIVERY' && t.deliveryStatus === 'PREPARING' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => statusMut.mutate({ id: t.id, status: 'OUT_FOR_DELIVERY' })}
                    >
                      Saiu para entrega
                    </button>
                  ) : null}
                  {t.fulfillment === 'PICKUP' && t.deliveryStatus === 'PREPARING' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => statusMut.mutate({ id: t.id, status: 'READY_PICKUP' })}
                    >
                      Pronto para retirada
                    </button>
                  ) : null}
                  <Link to={`/salao/comanda/${t.id}`} className="btn btn-secondary">
                    Abrir
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
