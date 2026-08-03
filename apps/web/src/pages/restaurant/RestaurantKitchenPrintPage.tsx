import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import './restaurant.css';

type Tab = {
  number: number;
  table: { code: string; label: string | null; area: { name: string } } | null;
  items: Array<{
    id: string;
    quantity: string | number;
    notes: string | null;
    status: string;
    kitchenPrintedAt?: string | null;
    printSector?: string | null;
    variant: { product: { name: string; taxUnit: string | null } };
  }>;
};

export function RestaurantKitchenPrintPage() {
  const { tabId = '' } = useParams();
  const tabQ = useQuery({
    queryKey: ['restaurant', 'tab', tabId, 'kitchen'],
    queryFn: () => api<Tab>(`/restaurant/tabs/${encodeURIComponent(tabId)}`),
    enabled: Boolean(tabId),
  });

  useEffect(() => {
    if (!tabQ.data) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [tabQ.data]);

  const tab = tabQ.data;
  const items = (tab?.items ?? []).filter((i) => i.status !== 'CANCELLED');

  return (
    <div className="kitchen-ticket">
      <header>
        <h1>COZINHA</h1>
        {tab && (
          <>
            <p>
              Comanda <strong>#{tab.number}</strong>
              {tab.table
                ? ` · ${tab.table.area.name} / ${tab.table.label || tab.table.code}`
                : ''}
            </p>
            <p className="kitchen-ticket__time">{new Date().toLocaleString('pt-BR')}</p>
          </>
        )}
      </header>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <strong>
              {Number(it.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
              {it.variant.product.taxUnit ? ` ${it.variant.product.taxUnit}` : '×'}
            </strong>{' '}
            {it.variant.product.name}
            {it.notes ? <div className="kitchen-ticket__notes">Obs: {it.notes}</div> : null}
            {it.printSector ? <div className="muted">{it.printSector}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
