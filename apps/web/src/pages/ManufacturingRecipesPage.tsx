import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { hasFactoryModule } from '../lib/auth';
import './restaurant/restaurant.css';

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

function ProductSuggest({
  term,
  query,
  onPick,
}: {
  term: string;
  query: { isFetching: boolean; isError: boolean; error: unknown; data?: ProductHit[] };
  onPick: (p: ProductHit) => void;
}) {
  const hits = (query.data ?? []).slice(0, 8);
  return (
    <ul className="restaurant-suggest" style={{ position: 'relative' }}>
      {query.isError ? (
        <li className="restaurant-suggest__msg">
          Falha na busca: {(query.error as Error)?.message || 'tente novamente'}
        </li>
      ) : hits.length === 0 ? (
        <li className="restaurant-suggest__msg">
          {query.isFetching ? 'Buscando…' : `Nenhum produto encontrado para “${term}”.`}
        </li>
      ) : (
        hits.map((p) => (
          <li key={p.variantId}>
            <button type="button" onClick={() => onPick(p)}>
              {p.productName} <span className="muted">· {p.sku}</span>
            </button>
          </li>
        ))
      )}
    </ul>
  );
}

export function ManufacturingRecipesPage() {
  const qc = useQueryClient();
  const moduleOk = hasFactoryModule();
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
    queryKey: ['products', 'search', 'mfg-recipe-pa', productQ],
    queryFn: () => api<ProductHit[]>(`/products/search?q=${encodeURIComponent(productQ.trim())}`),
    enabled: moduleOk && productQ.trim().length >= 1,
  });

  const ingsQ = useQuery({
    queryKey: ['products', 'search', 'mfg-recipe-ing', ingQ],
    queryFn: () => api<ProductHit[]>(`/products/search?q=${encodeURIComponent(ingQ.trim())}`),
    enabled: moduleOk && ingQ.trim().length >= 1,
  });

  const recipeQ = useQuery({
    queryKey: ['manufacturing', 'recipe', productId],
    queryFn: () => api<Recipe | null>(`/manufacturing/recipes/${encodeURIComponent(productId)}`),
    enabled: moduleOk && Boolean(productId),
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
      api(`/manufacturing/recipes/${encodeURIComponent(productId)}`, {
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
      setMsg('Ficha técnica salva. Projetos na Fábrica usarão esta BOM ao calcular insumos.');
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'recipe', productId] });
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

  if (!moduleOk) {
    return (
      <div className="page">
        <p className="muted">Módulo Fábrica não licenciado para esta empresa.</p>
      </div>
    );
  }

  return (
    <div className="page restaurant-page">
      <header className="restaurant-page__header">
        <div>
          <h1>Fichas técnicas</h1>
          <p className="muted">
            Para cada <strong>produto acabado</strong>, informe os insumos e a quantidade consumida por{' '}
            <strong>1 unidade</strong> fabricada. Ao criar um projeto, o sistema multiplica pela quantidade
            do pedido.
          </p>
          <p className="muted" style={{ marginTop: '0.35rem' }}>
            Depois de salvar a ficha, marque o produto como fabricável em{' '}
            <Link to="/produtos">Produtos</Link>.
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
          <label>Produto acabado</label>
          <input
            value={productQ || productLabel}
            onChange={(e) => {
              setProductQ(e.target.value);
              setProductLabel('');
              setProductId('');
            }}
            placeholder="Buscar pelo nome ou SKU…"
          />
          {productQ.trim().length >= 1 && (
            <ProductSuggest term={productQ.trim()} query={productsQ} onPick={onSelectProduct} />
          )}
        </div>
        {productId && recipeQ.isFetching && <p className="muted">Carregando ficha…</p>}
      </section>

      {productId && (
        <form className="card" onSubmit={onSubmit}>
          <h2>{productLabel}</h2>
          <div className="field">
            <label>Observações</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="field">
            <label>Adicionar insumo</label>
            <input
              value={ingQ}
              onChange={(e) => setIngQ(e.target.value)}
              placeholder="Buscar insumo (matéria-prima)…"
            />
            {ingQ.trim().length >= 1 && (
              <ProductSuggest
                term={ingQ.trim()}
                query={ingsQ}
                onPick={(p) => {
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
              />
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
                    aria-label="Quantidade por unidade do produto acabado"
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
