import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { hasRestaurantPlan } from '../../lib/auth';

type ProductHit = {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
};

type Recipe = {
  id: string;
  productId: string;
  notes: string | null;
  items: Array<{
    id: string;
    quantity: string | number;
    ingredientVariantId: string;
    ingredientVariant: {
      id: string;
      sku: string;
      product: { name: string; taxUnit: string | null };
    };
  }>;
};

export function RestaurantRecipesPage() {
  const qc = useQueryClient();
  const planOk = hasRestaurantPlan();
  const [productQ, setProductQ] = useState('');
  const [productId, setProductId] = useState('');
  const [productLabel, setProductLabel] = useState('');
  const [ingQ, setIngQ] = useState('');
  const [lines, setLines] = useState<Array<{ ingredientVariantId: string; label: string; quantity: string }>>(
    [],
  );
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const productsQ = useQuery({
    queryKey: ['products', 'search', 'recipe-dish', productQ],
    queryFn: () => api<ProductHit[]>(`/products/search?q=${encodeURIComponent(productQ.trim())}`),
    enabled: planOk && productQ.trim().length >= 1,
  });

  const ingsQ = useQuery({
    queryKey: ['products', 'search', 'recipe-ing', ingQ],
    queryFn: () => api<ProductHit[]>(`/products/search?q=${encodeURIComponent(ingQ.trim())}`),
    enabled: planOk && ingQ.trim().length >= 1,
  });

  const recipeQ = useQuery({
    queryKey: ['restaurant', 'recipe', productId],
    queryFn: () => api<Recipe | null>(`/restaurant/recipes/${encodeURIComponent(productId)}`),
    enabled: planOk && Boolean(productId),
  });

  useEffect(() => {
    const r = recipeQ.data;
    if (!productId) return;
    if (!r) {
      setLines([]);
      setNotes('');
      return;
    }
    setNotes(r.notes ?? '');
    setLines(
      r.items.map((it) => ({
        ingredientVariantId: it.ingredientVariantId,
        label: `${it.ingredientVariant.product.name} (${it.ingredientVariant.sku})`,
        quantity: String(it.quantity),
      })),
    );
  }, [productId, recipeQ.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/restaurant/recipes/${encodeURIComponent(productId)}`, {
        method: 'PATCH',
        json: {
          notes: notes.trim() || null,
          items: lines
            .filter((l) => l.ingredientVariantId && Number(String(l.quantity).replace(',', '.')) > 0)
            .map((l) => ({
              ingredientVariantId: l.ingredientVariantId,
              quantity: Number(String(l.quantity).replace(',', '.')),
            })),
        },
      }),
    onSuccess: () => {
      setMsg('Ficha técnica salva. Na venda, o estoque dos insumos será baixado.');
      void qc.invalidateQueries({ queryKey: ['restaurant', 'recipe', productId] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  function onSelectProduct(p: ProductHit) {
    setProductId(p.productId);
    setProductLabel(p.productName);
    setProductQ('');
    setLines([]);
    setNotes('');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!productId) return;
    save.mutate();
  }

  if (!planOk) {
    return (
      <div className="page">
        <p className="muted">Plano RESTAURANT necessário.</p>
      </div>
    );
  }

  return (
    <div className="page restaurant-page">
      <header className="restaurant-page__header">
        <div>
          <Link to="/salao" className="muted">
            ← Salão
          </Link>
          <h1>Fichas técnicas (BOM)</h1>
          <p className="muted">
            Por unidade (ou kg) do prato, informe a quantidade de cada insumo. Na venda, o estoque
            explode nos insumos.
          </p>
        </div>
      </header>

      {msg && (
        <div className="alert alert-ok" role="status">
          {msg}
        </div>
      )}

      <section className="card">
        <div className="field">
          <label>Produto acabado (prato)</label>
          <input
            value={productQ || productLabel}
            onChange={(e) => {
              setProductQ(e.target.value);
              setProductLabel('');
              setProductId('');
            }}
            placeholder="Buscar produto…"
          />
          {productQ.trim().length >= 1 && (
            <ul className="restaurant-suggest" style={{ position: 'relative' }}>
              {(productsQ.data ?? []).slice(0, 8).map((p) => (
                <li key={p.variantId}>
                  <button type="button" onClick={() => onSelectProduct(p)}>
                    {p.productName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {productId && recipeQ.isFetching && (
          <p className="muted">Carregando ficha…</p>
        )}
      </section>

      {productId && (
        <form className="card" onSubmit={onSubmit}>
          <h2>{productLabel}</h2>
          <div className="field">
            <label>Observações</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="field">
            <label>Adicionar insumo</label>
            <input
              value={ingQ}
              onChange={(e) => setIngQ(e.target.value)}
              placeholder="Buscar insumo…"
            />
            {ingQ.trim().length >= 1 && (
              <ul className="restaurant-suggest" style={{ position: 'relative' }}>
                {(ingsQ.data ?? []).slice(0, 8).map((p) => (
                  <li key={p.variantId}>
                    <button
                      type="button"
                      onClick={() => {
                        setLines((prev) => [
                          ...prev,
                          {
                            ingredientVariantId: p.variantId,
                            label: `${p.productName} (${p.sku})`,
                            quantity: '1',
                          },
                        ]);
                        setIngQ('');
                      }}
                    >
                      {p.productName}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ul className="restaurant-items">
            {lines.map((l, idx) => (
              <li key={`${l.ingredientVariantId}-${idx}`} className="restaurant-item-row">
                <div>{l.label}</div>
                <div className="restaurant-item-row__right">
                  <input
                    style={{ width: '6rem' }}
                    value={l.quantity}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLines((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, quantity: v } : x)),
                      );
                    }}
                    inputMode="decimal"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            Salvar ficha técnica
          </button>
        </form>
      )}
    </div>
  );
}
