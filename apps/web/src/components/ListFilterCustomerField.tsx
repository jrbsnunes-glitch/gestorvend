import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';

type CustomerHit = { id: string; name: string; document: string | null };

/** Cliente opcional em modais de filtro (busca `/customers/search`). */
export function ListFilterCustomerField({
  idPrefix,
  customerId,
  customerLabel,
  onSelect,
  onClear,
}: {
  idPrefix: string;
  customerId: string;
  customerLabel: string;
  onSelect: (c: CustomerHit) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const search = useQuery({
    queryKey: ['customers', 'search', 'list-filter', idPrefix, q],
    queryFn: () =>
      api<CustomerHit[]>(`/customers/search?q=${encodeURIComponent(q.trim())}`),
    enabled: open && q.trim().length >= 1,
  });

  if (customerId) {
    return (
      <div className="field filter-modal-row">
        <label htmlFor={`${idPrefix}-cust`}>Cliente</label>
        <div className="filter-customer-picked">
          <span id={`${idPrefix}-cust`}>{customerLabel}</span>
          <button type="button" className="btn btn-ghost btn-compact" onClick={onClear}>
            Limpar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field filter-modal-row">
      <label htmlFor={`${idPrefix}-cust-q`}>Cliente</label>
      <input
        id={`${idPrefix}-cust-q`}
        value={q}
        placeholder="Nome ou documento…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && q.trim().length >= 1 ? (
        <div className="filter-customer-hits">
          {search.isLoading ? (
            <p className="filter-customer-hits__empty">Buscando…</p>
          ) : !(search.data ?? []).length ? (
            <p className="filter-customer-hits__empty">Nenhum cliente.</p>
          ) : (
            (search.data ?? []).slice(0, 8).map((c) => (
              <button
                key={c.id}
                type="button"
                className="filter-customer-hits__btn"
                onClick={() => {
                  onSelect(c);
                  setQ('');
                  setOpen(false);
                }}
              >
                {c.name}
                {c.document ? ` · ${c.document}` : ''}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
