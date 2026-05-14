import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState } from 'react';
import { CrudToolbar, RowRecordActions } from '../components/CrudToolbar';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import {
  CategorySearchCombo,
  FISCAL_ORIGIN_OPTIONS,
  FiscalCodeSearchCombo,
} from '../components/ProductCatalogCombos';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';

type ProductSearchRow = {
  productId: string;
  productName: string;
  description: string | null;
  variantId: string;
  sku: string;
  barcode: string | null;
  retailPrice: string;
  costAverage: string;
  stockTotal: string;
};

type Variant = {
  id: string;
  sku: string;
  barcode: string | null;
  retailPrice: string;
  wholesalePrice: string | null;
  costAverage?: string;
  /** Estoque mínimo (ponto de reposição). Usado para alertas no PDV. */
  minStock?: string;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  defaultBarcode: string | null;
  ncm: string | null;
  cest: string | null;
  exTipi: string | null;
  fiscalOrigin: string | null;
  taxUnit: string | null;
  isActive: boolean;
  category?: { id: string; name: string } | null;
  variants: Variant[];
};

type PriceHistoryRow = {
  id: string;
  variantId: string;
  sku: string;
  field: string;
  previousValue: string;
  newValue: string;
  source: string;
  goodsReceiptId: string | null;
  createdAt: string;
};

function formatStockQty(value: string): string {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function profitBRL(retailStr: string, costStr: string): string {
  const r = parseFloat(String(retailStr).replace(',', '.')) || 0;
  const c = parseFloat(String(costStr).replace(',', '.')) || 0;
  return formatBRL(r - c);
}

function marginOnSalePct(retailStr: string, costStr: string): string {
  const r = parseFloat(String(retailStr).replace(',', '.')) || 0;
  const c = parseFloat(String(costStr).replace(',', '.')) || 0;
  if (r <= 0) return '—';
  return `${(((r - c) / r) * 100).toFixed(1)} %`;
}

export function ProductsPage() {
  const qc = useQueryClient();
  const [viewProductId, setViewProductId] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const searchQ = useDeferredValue(searchInput.trim());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultBarcode, setDefaultBarcode] = useState('');
  const [ncm, setNcm] = useState('');
  const [cest, setCest] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categoryNameHint, setCategoryNameHint] = useState('');
  const [exTipi, setExTipi] = useState('');
  const [fiscalOrigin, setFiscalOrigin] = useState('');
  const [taxUnit, setTaxUnit] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [sku, setSku] = useState('');
  const [retailPrice, setRetailPrice] = useState('0');
  const [costPrice, setCostPrice] = useState('0');
  const [minStockInput, setMinStockInput] = useState('0');
  const [variantPrices, setVariantPrices] = useState<
    Record<string, { retail: string; cost: string; minStock: string }>
  >({});
  const [err, setErr] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['products'],
    queryFn: () => api<Product[]>('/products'),
  });

  const productSearch = useQuery({
    queryKey: ['products', 'search', searchQ],
    queryFn: () => api<ProductSearchRow[]>(`/products/search?q=${encodeURIComponent(searchQ)}`),
    enabled: searchOpen && searchQ.length >= 1,
    staleTime: 5_000,
  });

  const viewRow = list.data?.find((p) => p.id === viewProductId) ?? null;

  const detail = useQuery({
    queryKey: ['products', viewProductId, 'view'],
    queryFn: () => api<Product>(`/products/${viewProductId}`),
    enabled: !!viewProductId && viewOpen,
  });

  const priceHistory = useQuery({
    queryKey: ['products', viewProductId, 'price-history'],
    queryFn: () => api<PriceHistoryRow[]>(`/products/${viewProductId}/price-history`),
    enabled: !!viewProductId && viewOpen,
  });

  const rows = useMemo(() => {
    return (list.data ?? []).flatMap((p) =>
      p.variants.length
        ? p.variants.map((v) => ({ product: p, variant: v }))
        : [{ product: p, variant: null as Variant | null }],
    );
  }, [list.data]);

  function resetCreateForm() {
    setName('');
    setDescription('');
    setDefaultBarcode('');
    setNcm('');
    setCest('');
    setCategoryId('');
    setCategoryNameHint('');
    setExTipi('');
    setFiscalOrigin('');
    setTaxUnit('');
    setSku('');
    setRetailPrice('0');
    setCostPrice('0');
    setMinStockInput('0');
    setErr(null);
  }

  function loadEditFromProduct(p: Product) {
    setName(p.name);
    setDescription(p.description ?? '');
    setDefaultBarcode(p.defaultBarcode ?? '');
    setNcm(p.ncm ?? '');
    setCest(p.cest ?? '');
    setCategoryId(p.category?.id ?? '');
    setCategoryNameHint(p.category?.name ?? '');
    setExTipi(p.exTipi ?? '');
    setFiscalOrigin(p.fiscalOrigin ?? '');
    setTaxUnit(p.taxUnit ?? '');
    setIsActive(p.isActive);
    const vp: Record<string, { retail: string; cost: string; minStock: string }> = {};
    for (const v of p.variants) {
      vp[v.id] = {
        retail: String(v.retailPrice),
        cost: String(v.costAverage ?? '0'),
        minStock: String(v.minStock ?? '0'),
      };
    }
    setVariantPrices(vp);
    setErr(null);
  }

  const create = useMutation({
    mutationFn: () =>
      api<Product>('/products', {
        method: 'POST',
        json: {
          name,
          description: description || null,
          defaultBarcode: defaultBarcode.trim() || null,
          ncm: ncm || null,
          cest: cest || null,
          exTipi: exTipi.trim() || null,
          fiscalOrigin: fiscalOrigin || null,
          taxUnit: taxUnit.trim() || null,
          categoryId: categoryId || null,
          variants: [
            {
              sku: sku || `SKU-${Date.now()}`,
              // Primeira variante: mesmo EAN que o padrão do produto.
              barcode: defaultBarcode.trim() || null,
              retailPrice: parseFloat(retailPrice.replace(',', '.')) || 0,
              costAverage: parseFloat(costPrice.replace(',', '.')) || 0,
              minStock: parseFloat(minStockInput.replace(',', '.')) || 0,
            },
          ],
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      setCreateOpen(false);
      resetCreateForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: (payload: { id: string; product: Product }) =>
      api<Product>(`/products/${payload.id}`, {
        method: 'PATCH',
        json: {
          name,
          description: description || null,
          defaultBarcode: defaultBarcode.trim() || null,
          ncm: ncm || null,
          cest: cest || null,
          exTipi: exTipi.trim() || null,
          fiscalOrigin: fiscalOrigin || null,
          taxUnit: taxUnit.trim() || null,
          categoryId: categoryId || null,
          isActive,
          variantPrices: payload.product.variants.map((v) => {
            const row = variantPrices[v.id];
            return {
              variantId: v.id,
              retailPrice: parseFloat((row?.retail ?? v.retailPrice).replace(',', '.')) || 0,
              costAverage: parseFloat((row?.cost ?? v.costAverage ?? '0').replace(',', '.')) || 0,
              minStock: parseFloat((row?.minStock ?? v.minStock ?? '0').replace(',', '.')) || 0,
            };
          }),
        },
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products', vars.id, 'price-history'] });
      setEditOpen(false);
      setEditProduct(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      setDeleteOpen(false);
      setDeleteProduct(null);
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const viewProduct = detail.data ?? viewRow;

  function openView(p: Product) {
    setViewProductId(p.id);
    setViewOpen(true);
  }

  function openEdit(p: Product) {
    loadEditFromProduct(p);
    setEditProduct(p);
    setEditOpen(true);
  }

  return (
    <div className="page print-area">
      <h1 className="page-title">Produtos</h1>
      <p className="page-desc">
        Produtos e variações (SKU). Categoria e tabelas fiscais (NCM, CEST, origem, unidade) com cadastro
        rápido no próprio formulário.
      </p>

      <CrudToolbar
        leadingPrimary={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSearchInput('');
              setSearchOpen(true);
            }}
          >
            Pesquisar
          </button>
        }
        onInclude={() => {
          resetCreateForm();
          setCreateOpen(true);
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal open={reportsOpen} title="Produtos" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Catálogo com custo e margem</li>
          <li>Lista de preços e etiquetas</li>
        </ul>
      </ModuleReportsModal>

      {searchOpen && (
        <div
          className="modal-backdrop modal-backdrop--wide no-print"
          role="presentation"
          onClick={() => setSearchOpen(false)}
        >
          <div className="modal modal--wide" role="dialog" aria-labelledby="product-search-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="product-search-title">Pesquisar produtos</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
              Busca em tempo real por nome, descrição, SKU ou código de barras. Uma linha por variação.
            </p>
            <div className="field" style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="product-search-q">Termo</label>
              <input
                id="product-search-q"
                type="search"
                autoComplete="off"
                autoFocus
                placeholder="Ex.: bebidas, SKU-001, 789…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            {productSearch.isError && (
              <div className="alert alert-error">{(productSearch.error as Error).message}</div>
            )}
            <div className="table-wrap" style={{ maxHeight: 'min(55vh, 420px)', overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>SKU</th>
                    <th>Descrição</th>
                    <th>Venda</th>
                    <th>Custo médio</th>
                    <th>Estoque total</th>
                  </tr>
                </thead>
                <tbody>
                  {searchQ.length < 1 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        Digite para buscar.
                      </td>
                    </tr>
                  )}
                  {searchQ.length >= 1 && productSearch.isPending && (
                    <tr>
                      <td colSpan={6} className="empty">
                        Buscando…
                      </td>
                    </tr>
                  )}
                  {searchQ.length >= 1 &&
                    !productSearch.isPending &&
                    Array.isArray(productSearch.data) &&
                    productSearch.data.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        Nenhum resultado para «{searchQ}».
                      </td>
                    </tr>
                  )}
                  {searchQ.length >= 1 &&
                    (productSearch.data ?? []).map((row) => (
                    <tr
                      key={row.variantId}
                      style={{ cursor: 'pointer' }}
                      title="Clique para visualizar o produto"
                      onClick={() => {
                        setSearchOpen(false);
                        setViewProductId(row.productId);
                        setViewOpen(true);
                      }}
                    >
                      <td>
                        <strong>{row.productName}</strong>
                      </td>
                      <td>
                        <span>{row.sku}</span>
                        {row.barcode && (
                          <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                            {row.barcode}
                          </span>
                        )}
                      </td>
                      <td style={{ maxWidth: '22rem', whiteSpace: 'normal', fontSize: '0.9rem' }}>
                        {row.description?.trim() ? row.description : '—'}
                      </td>
                      <td>{formatBRL(row.retailPrice)}</td>
                      <td>{formatBRL(row.costAverage)}</td>
                      <td>{formatStockQty(row.stockTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setSearchOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toolbar no-print">
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {list.data?.length ?? 0} produto(s)
        </span>
      </div>

      {list.isError && <div className="alert alert-error">{(list.error as Error).message}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th>SKU</th>
              <th>NCM / CEST</th>
              <th>Preço varejo</th>
              <th>Custo médio</th>
              <th>Status</th>
              <th className="col-actions">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={8} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!list.isLoading && !rows.length && (
              <tr>
                <td colSpan={8} className="empty">
                  Nenhum produto.
                </td>
              </tr>
            )}
            {rows.map(({ product, variant }) => (
              <tr key={`${product.id}-${variant?.id ?? 'x'}`}>
                <td>
                  <strong>{product.name}</strong>
                </td>
                <td>{product.category?.name ?? '—'}</td>
                <td>{variant?.sku ?? '—'}</td>
                <td>
                  <span style={{ fontSize: '0.85rem' }}>
                    {product.ncm ?? '—'} / {product.cest ?? '—'}
                  </span>
                </td>
                <td>{variant ? formatBRL(variant.retailPrice) : '—'}</td>
                <td>{variant ? formatBRL(variant.costAverage ?? '0') : '—'}</td>
                <td>
                  <span className={'badge ' + (product.isActive ? 'badge-success' : 'badge-muted')}>
                    {product.isActive ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="col-actions">
                  <RowRecordActions
                    onEdit={() => openEdit(product)}
                    onView={() => openView(product)}
                    onDelete={() => {
                      setDeleteProduct(product);
                      setDeleteOpen(true);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <div
          className="modal-backdrop modal-backdrop--wide no-print"
          role="presentation"
          onClick={() => {
            setCreateOpen(false);
            setErr(null);
          }}
        >
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Novo produto</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
              Primeira variação (SKU) pode ser ajustada depois pela API.
            </p>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="form-row">
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="p-name">Nome *</label>
                <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="p-desc-c">Descrição</label>
              <textarea
                id="p-desc-c"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Descrição complementar (aparece em recibos e relatórios)"
              />
            </div>
            <div className="modal-wide-split">
              <details className="submenu-details" open>
                <summary className="submenu-summary">Categoria</summary>
                <div className="submenu-body">
                  <div className="field">
                    <span className="field-label-text">Pesquisar ou incluir</span>
                    <CategorySearchCombo
                      id="p-cat"
                      value={categoryId}
                      onChange={(id, picked) => {
                        setCategoryId(id);
                        if (picked) setCategoryNameHint(picked);
                        if (!id) setCategoryNameHint('');
                      }}
                      hintName={categoryNameHint}
                    />
                  </div>
                </div>
              </details>
              <details className="submenu-details" open>
                <summary className="submenu-summary">Dados fiscais</summary>
                <div className="submenu-body">
                  <div className="form-row">
                    <div className="field">
                      <span className="field-label-text">NCM</span>
                      <FiscalCodeSearchCombo
                        kind="ncm"
                        id="p-ncm"
                        label="NCM"
                        value={ncm}
                        onChange={setNcm}
                        hintLabel={ncm || null}
                      />
                    </div>
                    <div className="field">
                      <span className="field-label-text">CEST</span>
                      <FiscalCodeSearchCombo
                        kind="cest"
                        id="p-cest"
                        label="CEST"
                        value={cest}
                        onChange={setCest}
                        hintLabel={cest || null}
                        ncmHint={ncm || null}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="field">
                      <label htmlFor="p-extipi">EX TIPI</label>
                      <input
                        id="p-extipi"
                        value={exTipi}
                        onChange={(e) => setExTipi(e.target.value)}
                        placeholder="Opcional"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="p-origin">Origem da mercadoria (ICMS)</label>
                      <select
                        id="p-origin"
                        value={fiscalOrigin}
                        onChange={(e) => setFiscalOrigin(e.target.value)}
                      >
                        <option value="">— Não informado —</option>
                        {FISCAL_ORIGIN_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label-text">Unidade tributável</span>
                    <FiscalCodeSearchCombo
                      kind="tax-units"
                      id="p-taxunit"
                      label="Unidade tributável"
                      value={taxUnit}
                      onChange={setTaxUnit}
                      hintLabel={taxUnit || null}
                    />
                  </div>
                </div>
              </details>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="p-sku">SKU</label>
                <input id="p-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Auto se vazio" />
              </div>
              <div className="field">
                <label htmlFor="p-ean">Código de barras</label>
                <input
                  id="p-ean"
                  value={defaultBarcode}
                  onChange={(e) => setDefaultBarcode(e.target.value.trim())}
                  placeholder="EAN (ex.: 7891000000000)"
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="p-price">Preço de venda (varejo) *</label>
                <input
                  id="p-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={retailPrice}
                  onChange={(e) => setRetailPrice(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="p-cost">Preço de custo</label>
                <input
                  id="p-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                />
              </div>
              <div className="field">
                <span className="field-label-text">Lucro (automático)</span>
                <div
                  className="product-profit-box"
                  style={{
                    padding: '0.55rem 0.75rem',
                    border: '1px solid var(--color-border-strong)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-surface-elevated)',
                    fontWeight: 600,
                  }}
                >
                  {profitBRL(retailPrice, costPrice)}
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                      marginTop: '0.2rem',
                    }}
                  >
                    Margem sobre venda: {marginOnSalePct(retailPrice, costPrice)}
                  </span>
                </div>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="p-minstock">Estoque mínimo (ponto de reposição)</label>
                <input
                  id="p-minstock"
                  type="number"
                  step="1"
                  min="0"
                  value={minStockInput}
                  onChange={(e) => setMinStockInput(e.target.value)}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                  PDV avisa quando o saldo ficar abaixo deste valor.
                </span>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {editProduct && editOpen && (
        <div className="modal-backdrop modal-backdrop--wide no-print" role="presentation" onClick={() => setEditOpen(false)}>
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Alterar produto</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="form-row">
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="pe-name">Nome *</label>
                <input id="pe-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="pe-bar">Código de barras</label>
                <input
                  id="pe-bar"
                  value={defaultBarcode}
                  onChange={(e) => setDefaultBarcode(e.target.value.trim())}
                  placeholder="EAN do produto"
                  inputMode="numeric"
                />
              </div>
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="pe-desc">Descrição</label>
                <textarea id="pe-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>
            </div>
            <div className="modal-wide-split">
              <details className="submenu-details" open>
                <summary className="submenu-summary">Categoria</summary>
                <div className="submenu-body">
                  <div className="field">
                    <span className="field-label-text">Pesquisar ou incluir</span>
                    <CategorySearchCombo
                      id="pe-cat"
                      value={categoryId}
                      onChange={(id, picked) => {
                        setCategoryId(id);
                        if (picked) setCategoryNameHint(picked);
                        if (!id) setCategoryNameHint('');
                      }}
                      hintName={categoryNameHint}
                    />
                  </div>
                </div>
              </details>
              <details className="submenu-details" open>
                <summary className="submenu-summary">Dados fiscais</summary>
                <div className="submenu-body">
                  <div className="form-row">
                    <div className="field">
                      <span className="field-label-text">NCM</span>
                      <FiscalCodeSearchCombo
                        kind="ncm"
                        id="pe-ncm"
                        label="NCM"
                        value={ncm}
                        onChange={setNcm}
                        hintLabel={ncm || null}
                      />
                    </div>
                    <div className="field">
                      <span className="field-label-text">CEST</span>
                      <FiscalCodeSearchCombo
                        kind="cest"
                        id="pe-cest"
                        label="CEST"
                        value={cest}
                        onChange={setCest}
                        hintLabel={cest || null}
                        ncmHint={ncm || null}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="field">
                      <label htmlFor="pe-extipi">EX TIPI</label>
                      <input
                        id="pe-extipi"
                        value={exTipi}
                        onChange={(e) => setExTipi(e.target.value)}
                        placeholder="Opcional"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="pe-origin">Origem da mercadoria (ICMS)</label>
                      <select
                        id="pe-origin"
                        value={fiscalOrigin}
                        onChange={(e) => setFiscalOrigin(e.target.value)}
                      >
                        <option value="">— Não informado —</option>
                        {FISCAL_ORIGIN_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label-text">Unidade tributável</span>
                    <FiscalCodeSearchCombo
                      kind="tax-units"
                      id="pe-taxunit"
                      label="Unidade tributável"
                      value={taxUnit}
                      onChange={setTaxUnit}
                      hintLabel={taxUnit || null}
                    />
                  </div>
                </div>
              </details>
            </div>
            <h3
              style={{
                fontSize: '0.88rem',
                fontWeight: 700,
                margin: '1rem 0 0.5rem',
                color: 'var(--color-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Preços por variação
            </h3>
            {editProduct.variants.map((v) => {
              const row = variantPrices[v.id] ?? {
                retail: String(v.retailPrice),
                cost: String(v.costAverage ?? '0'),
                minStock: String(v.minStock ?? '0'),
              };
              return (
                <div key={v.id} className="form-row">
                  <div className="field">
                    <span className="field-label-text">SKU</span>
                    <div
                      style={{
                        padding: '0.55rem 0.75rem',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-surface)',
                        fontSize: '0.9rem',
                      }}
                    >
                      {v.sku}
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor={`pe-r-${v.id}`}>Preço de venda</label>
                    <input
                      id={`pe-r-${v.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.retail}
                      onChange={(e) =>
                        setVariantPrices((s) => ({ ...s, [v.id]: { ...row, retail: e.target.value } }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`pe-c-${v.id}`}>Preço de custo</label>
                    <input
                      id={`pe-c-${v.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.cost}
                      onChange={(e) =>
                        setVariantPrices((s) => ({ ...s, [v.id]: { ...row, cost: e.target.value } }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`pe-m-${v.id}`}>Estoque mínimo</label>
                    <input
                      id={`pe-m-${v.id}`}
                      type="number"
                      step="1"
                      min="0"
                      value={row.minStock}
                      onChange={(e) =>
                        setVariantPrices((s) => ({ ...s, [v.id]: { ...row, minStock: e.target.value } }))
                      }
                    />
                  </div>
                  <div className="field">
                    <span className="field-label-text">Lucro</span>
                    <div
                      style={{
                        padding: '0.55rem 0.75rem',
                        border: '1px solid var(--color-border-strong)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-surface-elevated)',
                        fontWeight: 600,
                      }}
                    >
                      {profitBRL(row.retail, row.cost)}
                      <span
                        style={{
                          display: 'block',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          color: 'var(--color-text-secondary)',
                          marginTop: '0.2rem',
                        }}
                      >
                        Margem: {marginOnSalePct(row.retail, row.cost)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="field">
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                Ativo
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!name.trim() || update.isPending}
                onClick={() => update.mutate({ id: editProduct.id, product: editProduct })}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {viewProductId && viewOpen && viewProduct && (
        <div className="modal-backdrop modal-backdrop--wide no-print" role="presentation" onClick={() => setViewOpen(false)}>
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Produto — visualização</h2>
            {detail.isLoading && <p>Carregando…</p>}
            {detail.isError && (
              <div className="alert alert-error">{(detail.error as Error).message}</div>
            )}
            {!detail.isLoading && !detail.isError && (
              <div className="modal-view-grid">
                <p>
                  <strong>Nome:</strong> {viewProduct.name}
                </p>
                <p>
                  <strong>Descrição:</strong> {viewProduct.description ?? '—'}
                </p>
                <p>
                  <strong>Categoria:</strong> {viewProduct.category?.name ?? '—'}
                </p>
                <p>
                  <strong>NCM / CEST:</strong> {viewProduct.ncm ?? '—'} / {viewProduct.cest ?? '—'}
                </p>
                <p>
                  <strong>EX TIPI:</strong> {viewProduct.exTipi ?? '—'}
                </p>
                <p>
                  <strong>Origem (ICMS):</strong>{' '}
                  {viewProduct.fiscalOrigin != null && viewProduct.fiscalOrigin !== ''
                    ? FISCAL_ORIGIN_OPTIONS.find((o) => o.value === viewProduct.fiscalOrigin)?.label ??
                      viewProduct.fiscalOrigin
                    : '—'}
                </p>
                <p>
                  <strong>Unidade tributável:</strong> {viewProduct.taxUnit ?? '—'}
                </p>
                <p>
                  <strong>Status:</strong> {viewProduct.isActive ? 'Ativo' : 'Inativo'}
                </p>
                <h3 style={{ fontSize: '0.95rem', marginTop: '1rem' }}>Variações (SKU)</h3>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                  {viewProduct.variants.map((v) => (
                    <li key={v.id}>
                      <strong>{v.sku}</strong> — venda {formatBRL(v.retailPrice)} · custo{' '}
                      {formatBRL(v.costAverage ?? '0')} · lucro {profitBRL(String(v.retailPrice), String(v.costAverage ?? '0'))}
                      {v.barcode ? ` · EAN ${v.barcode}` : ''}
                    </li>
                  ))}
                </ul>
                <h3 style={{ fontSize: '0.95rem', marginTop: '1.25rem' }}>Histórico de preços</h3>
                {priceHistory.isError && (
                  <div className="alert alert-error">{(priceHistory.error as Error).message}</div>
                )}
                {priceHistory.isLoading && <p style={{ fontSize: '0.9rem' }}>Carregando histórico…</p>}
                {!priceHistory.isLoading && !priceHistory.isError && (priceHistory.data?.length ?? 0) === 0 && (
                  <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Nenhuma alteração registrada ainda.</p>
                )}
                {(priceHistory.data?.length ?? 0) > 0 && (
                  <div className="table-wrap" style={{ maxHeight: '240px', overflow: 'auto' }}>
                    <table className="data-table" style={{ fontSize: '0.85rem' }}>
                      <thead>
                        <tr>
                          <th>Quando</th>
                          <th>SKU</th>
                          <th>Campo</th>
                          <th>De</th>
                          <th>Para</th>
                          <th>Origem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(priceHistory.data ?? []).map((h) => (
                          <tr key={h.id}>
                            <td>{formatDate(h.createdAt)}</td>
                            <td>{h.sku}</td>
                            <td>{h.field === 'RETAIL' ? 'Venda' : h.field === 'COST' ? 'Custo' : h.field}</td>
                            <td>{formatBRL(h.previousValue)}</td>
                            <td>{formatBRL(h.newValue)}</td>
                            <td>{h.source === 'GOODS_RECEIPT' ? 'Entrada NF' : h.source === 'MANUAL' ? 'Cadastro' : h.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setViewOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteProduct && deleteOpen && (
        <div className="modal-backdrop no-print" role="presentation" onClick={() => setDeleteOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Excluir produto</h2>
            <p>
              Confirma a exclusão de <strong>{deleteProduct.name}</strong> e todas as suas variações?
            </p>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleteProduct.id)}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
