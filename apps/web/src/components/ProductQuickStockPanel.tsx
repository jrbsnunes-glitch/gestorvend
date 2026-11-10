import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NumericInput } from './NumericInput';
import { api } from '../lib/api';

type Location = { id: string; code: string; name: string; isDefault?: boolean };

export function ProductQuickStockPanel({
  createMode,
  blockedReason,
  locationId,
  countedQty,
  notes,
  onLocationId,
  onCountedQty,
  onNotes,
  variants,
  variantId,
  onVariantId,
}: {
  createMode: boolean;
  blockedReason: string | null;
  locationId: string;
  countedQty: string;
  notes: string;
  onLocationId: (id: string) => void;
  onCountedQty: (value: string) => void;
  onNotes: (value: string) => void;
  variants?: Array<{ id: string; sku: string }>;
  variantId?: string;
  onVariantId?: (id: string) => void;
}) {
  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Location[]>('/stock-locations'),
  });

  useEffect(() => {
    if (locationId || !locations.data?.length) return;
    const preferred = locations.data.find((l) => l.isDefault) ?? locations.data[0];
    if (preferred) onLocationId(preferred.id);
  }, [locationId, locations.data, onLocationId]);

  return (
    <div className="form-modal-tab-panel" role="tabpanel">
      <section className="product-form__section" aria-label="Estoque rápido">
        <p className="product-form__section-title">Inventário do item</p>
        <p className="form-cadastro-modal__hint">
          {createMode
            ? 'Opcional. Ao salvar, o sistema cria o produto e posta um inventário só deste item no local escolhido. O saldo fica igual à quantidade contada.'
            : 'Opcional. Ao salvar, a quantidade contada substitui o saldo desta variação no local, como um inventário postado.'}{' '}
          Deixe em branco para não mexer no estoque.
        </p>
        {blockedReason ? (
          <div className="alert alert-info">{blockedReason}</div>
        ) : (
          <>
            {locations.isError ? (
              <div className="alert alert-error">Não foi possível carregar os locais de estoque.</div>
            ) : null}
            {variants && variants.length > 1 && onVariantId ? (
              <div className="field">
                <label htmlFor="qs-variant">Variação</label>
                <select
                  id="qs-variant"
                  value={variantId ?? variants[0]?.id ?? ''}
                  onChange={(e) => onVariantId(e.target.value)}
                >
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.sku}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="form-row">
              <div className="field">
                <label htmlFor="qs-loc">Local de estoque</label>
                <select
                  id="qs-loc"
                  value={locationId}
                  onChange={(e) => onLocationId(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {(locations.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="qs-qty">Quantidade contada</label>
                <NumericInput
                  id="qs-qty"
                  min={0}
                  value={countedQty}
                  onChange={onCountedQty}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="qs-notes">Observação do inventário</label>
              <input
                id="qs-notes"
                value={notes}
                onChange={(e) => onNotes(e.target.value)}
                placeholder="Ex.: contagem na abertura do cadastro"
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export async function postQuickStockInventory(input: {
  variantId: string;
  locationId: string;
  countedQty: number;
  notes: string;
  productName: string;
}): Promise<void> {
  const inv = await api<{ id: string }>('/stock-inventories', {
    method: 'POST',
    json: {
      locationId: input.locationId,
      notes: input.notes.trim() || `Estoque rápido — ${input.productName}`,
    },
  });
  await api(`/stock-inventories/${inv.id}/items`, {
    method: 'POST',
    json: { variantId: input.variantId, countedQty: input.countedQty },
  });
  await api(`/stock-inventories/${inv.id}/post`, { method: 'POST', json: {} });
}
