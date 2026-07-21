import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { CrudToolbar, RowRecordActions } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ListPagination } from '../components/ListPagination';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import {
  CategorySearchCombo,
  FISCAL_ORIGIN_OPTIONS,
  FiscalCodeSearchCombo,
} from '../components/ProductCatalogCombos';
import {
  draftLinksFromApi,
  linksToCreatePayload,
  linksToPayload,
  ProductSupplierLinksSection,
  type SupplierLinkDraft,
} from '../components/ProductSupplierLinksSection';
import { ProductReportsPanel } from '../components/ProductReportsPanel';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';
import { useListPagination } from '../hooks/useListPagination';

type ProductSearchRow = {
  productId: string;
  productName: string;
  description: string | null;
  /** Código sequencial único do produto (PDV / listagem). */
  productControlNumber?: number;
  /** Menor estoque mínimo entre SKUs — usado em relatórios por intervalo. */
  productInventoryControlMin?: string;
  variantId: string;
  sku: string;
  barcode: string | null;
  retailPrice: string;
  costAverage: string;
  stockTotal: string;
  minStock?: string;
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
  /** Código sequencial único gerado automaticamente no cadastro. */
  controlNumber?: number;
  /** Menor `minStock` entre variantes; usado nos relatórios por intervalo. */
  inventoryControlMin?: string;
  ncm: string | null;
  cest: string | null;
  exTipi: string | null;
  fiscalOrigin: string | null;
  taxUnit: string | null;
  conversion: string | null;
  isActive: boolean;
  category?: { id: string; name: string } | null;
  fiscalSituationId?: string | null;
  fiscalSituation?: { id: string; code: string; name: string } | null;
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

function formatProductCode(value: number | string | null | undefined): string {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return String(n);
}

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

/** Menor `minStock` entre variantes usando os valores já editados nos campos — prévia do próximo «controle produto». */
function minMinStockFromVariantForm(
  variants: Variant[],
  vp: Record<string, { retail: string; cost: string; minStock: string }>,
): number {
  if (!variants.length) return 1;
  return Math.min(
    ...variants.map((v) => {
      const n = parseFloat((vp[v.id]?.minStock ?? v.minStock ?? '1').replace(',', '.'));
      const parsed = Number.isFinite(n) ? n : 1;
      return Math.max(1, parsed);
    }),
  );
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
  const [searchActionErr, setSearchActionErr] = useState<string | null>(null);
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
  const [conversion, setConversion] = useState('');
  const [fiscalSituationId, setFiscalSituationId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [sku, setSku] = useState('');
  const [retailPrice, setRetailPrice] = useState('0');
  const [costPrice, setCostPrice] = useState('0');
  const [minStockInput, setMinStockInput] = useState('1');
  const [variantPrices, setVariantPrices] = useState<
    Record<string, { retail: string; cost: string; minStock: string }>
  >({});
  const [err, setErr] = useState<string | null>(null);
  const [supplierLinks, setSupplierLinks] = useState<SupplierLinkDraft[]>([]);

  const list = useQuery({
    queryKey: ['products'],
    queryFn: () => api<Product[]>('/products'),
  });

  const fiscalSituationsQ = useQuery({
    queryKey: ['fiscal-situations'],
    queryFn: () =>
      api<Array<{ id: string; code: string; name: string; isActive: boolean }>>('/fiscal-situations'),
    staleTime: 60_000,
  });

  const productSearch = useQuery({
    queryKey: ['products', 'search', searchQ],
    queryFn: () => api<ProductSearchRow[]>(`/products/search?q=${encodeURIComponent(searchQ)}`),
    enabled: searchOpen && searchQ.length >= 1,
    staleTime: 5_000,
  });

  const editSupplierLinksQ = useQuery({
    queryKey: ['products', editProduct?.id, 'supplier-links'],
    queryFn: () =>
      api<
        Array<{
          supplierId: string;
          variantId: string;
          supplierProductCode: string;
          supplier: { legalName: string };
        }>
      >(`/products/${editProduct!.id}/supplier-links`),
    enabled: !!editProduct && editOpen,
  });

  useEffect(() => {
    if (editOpen && editSupplierLinksQ.data) {
      setSupplierLinks(draftLinksFromApi(editSupplierLinksQ.data));
    }
  }, [editOpen, editSupplierLinksQ.data]);

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
    const sortedProducts = [...(list.data ?? [])].sort((a, b) => {
      const codeA = a.controlNumber ?? 0;
      const codeB = b.controlNumber ?? 0;
      if (codeA !== codeB) return codeA - codeB;
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    });

    return sortedProducts.flatMap((p) => {
      const variants = [...p.variants].sort((a, b) =>
        a.sku.localeCompare(b.sku, 'pt-BR', { sensitivity: 'base' }),
      );
      return variants.length
        ? variants.map((v) => ({ product: p, variant: v }))
        : [{ product: p, variant: null as Variant | null }];
    });
  }, [list.data]);

  const pagination = useListPagination(rows, 20);

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
    setConversion('');
    setFiscalSituationId('');
    setSku('');
    setRetailPrice('0');
    setCostPrice('0');
    setMinStockInput('1');
    setSupplierLinks([]);
    setIsActive(true);
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
    setConversion(p.conversion ?? '');
    setFiscalSituationId(p.fiscalSituation?.id ?? p.fiscalSituationId ?? '');
    setIsActive(p.isActive);
    const vp: Record<string, { retail: string; cost: string; minStock: string }> = {};
    for (const v of p.variants) {
      vp[v.id] = {
        retail: String(v.retailPrice),
        cost: String(v.costAverage ?? '0'),
        minStock: String(v.minStock ?? '1'),
      };
    }
    setVariantPrices(vp);
    setSupplierLinks([]);
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
          conversion: conversion.trim() || null,
          categoryId: categoryId || null,
          fiscalSituationId: fiscalSituationId || null,
          variants: [
            {
              sku: sku || `SKU-${Date.now()}`,
              // Primeira variante: mesmo EAN que o padrão do produto.
              barcode: defaultBarcode.trim() || null,
              retailPrice: parseFloat(retailPrice.replace(',', '.')) || 0,
              costAverage: parseFloat(costPrice.replace(',', '.')) || 0,
              minStock: Math.max(1, parseFloat(minStockInput.replace(',', '.')) || 1),
            },
          ],
          supplierLinks: linksToCreatePayload(supplierLinks),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      resetCreateForm();
      requestAnimationFrame(() => document.getElementById('p-name')?.focus());
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: async (payload: { id: string; product: Product }) => {
      const product = await api<Product>(`/products/${payload.id}`, {
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
          conversion: conversion.trim() || null,
          fiscalSituationId: fiscalSituationId || null,
          categoryId: categoryId || null,
          variantPrices: payload.product.variants.map((v) => {
            const row = variantPrices[v.id];
            return {
              variantId: v.id,
              retailPrice: parseFloat((row?.retail ?? v.retailPrice).replace(',', '.')) || 0,
              costAverage: parseFloat((row?.cost ?? v.costAverage ?? '0').replace(',', '.')) || 0,
              minStock: Math.max(1, parseFloat((row?.minStock ?? v.minStock ?? '1').replace(',', '.')) || 1),
            };
          }),
        },
      });
      await api(`/products/${payload.id}/supplier-links`, {
        method: 'PUT',
        json: { links: linksToPayload(supplierLinks) },
      });
      return product;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products', vars.id, 'supplier-links'] });
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

  async function openEditFromSearch(productId: string) {
    setSearchActionErr(null);
    try {
      const cached = list.data?.find((p) => p.id === productId);
      const product = cached ?? (await api<Product>(`/products/${productId}`));
      setSearchOpen(false);
      setSearchInput('');
      openEdit(product);
    } catch (e) {
      setSearchActionErr(
        e instanceof Error ? e.message : 'Não foi possível abrir o produto para edição.',
      );
    }
  }

  return (
    <div className="page print-area">
      <h1 className="page-title">Produtos</h1>
      <p className="page-desc">
        Produtos e variações (SKU). Cada produto recebe um <strong>código sequencial único</strong> (1ª coluna) para pesquisa no PDV. Cadastro não aceita estoque mínimo abaixo de <strong>1</strong> por SKU; o{' '}
        <strong>mín. cadastro</strong> replica o menor mínimo da família (relatórios por intervalo).{' '}
        <strong>Mín. SKU</strong> define o ponto de reposição no PDV/alertas. Categoria e dados fiscais no formulário.
      </p>

      <ReportPrintSticker
        documentTitle="Produtos e variações"
        documentExtras={
          <p className="print-sub page-desc" style={{ marginBottom: 0 }}>
            Lista operacional atual da tabela abaixo. Use os filtros e a ordenação antes de imprimir quando
            necessário para auditorias internas.
          </p>
        }
      />

      <CrudToolbar
        leadingPrimary={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSearchInput('');
              setSearchActionErr(null);
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

      <ModuleReportsModal open={reportsOpen} title="Produtos" compactLauncher onClose={() => setReportsOpen(false)}>
        <ProductReportsPanel />
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
            {searchActionErr && <div className="alert alert-error">{searchActionErr}</div>}
            <div className="table-wrap" style={{ maxHeight: 'min(55vh, 420px)', overflow: 'auto' }}>
              <table className="data-table products-search-table">
                <thead>
                  <tr>
                    <th className="num th-nowrap products-search-table__ctr">Código</th>
                    <th>Produto</th>
                    <th className="products-search-table__sku-th">SKU</th>
                    <th className="num th-nowrap products-search-table__vmin">Mín. SKU</th>
                    <th>Descrição</th>
                    <th className="num col-money th-nowrap products-search-table__money">Venda</th>
                    <th className="num col-money th-nowrap products-search-table__money">Custo</th>
                    <th className="num th-nowrap products-search-table__stk">Est. total</th>
                    <th className="col-actions no-print">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {searchQ.length < 1 && (
                    <tr>
                      <td colSpan={9} className="empty">
                        Digite para buscar.
                      </td>
                    </tr>
                  )}
                  {searchQ.length >= 1 && productSearch.isPending && (
                    <tr>
                      <td colSpan={9} className="empty">
                        Buscando…
                      </td>
                    </tr>
                  )}
                  {searchQ.length >= 1 &&
                    !productSearch.isPending &&
                    Array.isArray(productSearch.data) &&
                    productSearch.data.length === 0 && (
                    <tr>
                      <td colSpan={9} className="empty">
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
                      <td className="num products-search-table__ctr" title="Código sequencial do produto">
                        {formatProductCode(row.productControlNumber)}
                      </td>
                      <td>
                        <strong>{row.productName}</strong>
                      </td>
                      <td className="products-search-table__sku" title={row.sku}>
                        <span>{row.sku}</span>
                        {row.barcode && (
                          <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                            {row.barcode}
                          </span>
                        )}
                      </td>
                      <td className="num products-search-table__vmin">{formatStockQty(row.minStock ?? '1')}</td>
                      <td style={{ maxWidth: '22rem', whiteSpace: 'normal', fontSize: '0.9rem' }}>
                        {row.description?.trim() ? row.description : '—'}
                      </td>
                      <td className="num col-money products-search-table__money">{formatBRL(row.retailPrice)}</td>
                      <td className="num col-money products-search-table__money">{formatBRL(row.costAverage)}</td>
                      <td className="num products-search-table__stk">{formatStockQty(row.stockTotal)}</td>
                      <td className="col-actions no-print">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          title="Editar produto"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openEditFromSearch(row.productId);
                          }}
                        >
                          Editar
                        </button>
                      </td>
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
          {pagination.totalItems > pagination.pageSize
            ? ` · ${pagination.totalItems} linha(s) na grade`
            : ''}
        </span>
      </div>

      {list.isError && <div className="alert alert-error">{(list.error as Error).message}</div>}

      <div className="table-wrap">
        <table className="data-table products-list-table">
          <thead>
            <tr>
              <th
                className="num th-nowrap col-inv-ctrl"
                title="Código sequencial único do produto (pesquisável no PDV)"
              >
                Código
              </th>
              <th className="col-product-name">Produto</th>
              <th className="col-category">Categoria</th>
              <th className="col-sku" title="Código SKU">
                SKU
              </th>
              <th className="num th-nowrap col-min-sku-table" title="Est. mín. deste SKU">
                Mín. SKU
              </th>
              <th className="col-ncm-ce">NCM / CEST</th>
              <th className="num col-money th-nowrap">Varejo</th>
              <th className="num col-money th-nowrap">Custo méd.</th>
              <th className="col-status">Status</th>
              <th className="col-actions">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={10} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!list.isLoading && !rows.length && (
              <tr>
                <td colSpan={10} className="empty">
                  Nenhum produto.
                </td>
              </tr>
            )}
            {pagination.pageItems.map(({ product, variant }) => (
              <tr key={`${product.id}-${variant?.id ?? 'x'}`}>
                <td className="num col-inv-ctrl">{formatProductCode(product.controlNumber)}</td>
                <td className="col-product-name">
                  <strong>{product.name}</strong>
                </td>
                <td className="col-category">{product.category?.name ?? '—'}</td>
                <td className="col-sku" title={variant?.sku ?? undefined}>
                  {variant?.sku ?? '—'}
                </td>
                <td className="num col-min-sku-table">{variant ? formatStockQty(variant.minStock ?? '1') : '—'}</td>
                <td className="col-ncm-ce">
                  <span style={{ fontSize: '0.85rem' }}>
                    {product.ncm ?? '—'} / {product.cest ?? '—'}
                  </span>
                </td>
                <td className="num col-money">{variant ? formatBRL(variant.retailPrice) : '—'}</td>
                <td className="num col-money">{variant ? formatBRL(variant.costAverage ?? '0') : '—'}</td>
                <td className="col-status">
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

      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        pageSize={pagination.pageSize}
        onPageChange={pagination.setPage}
        itemLabel="linha(s)"
      />

      {createOpen && (
        <FormModalBackdrop
          className="modal-backdrop--wide no-print"
          onClose={() => {
            setCreateOpen(false);
            setErr(null);
          }}
        >
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Novo produto</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
              Primeira variação (SKU) pode ser ajustada depois. O <strong>código sequencial</strong> do produto é gerado automaticamente ao salvar.
            </p>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="product-form">
              <section className="product-form__section" aria-label="Identificação e preços">
                <p className="product-form__section-title">Identificação e preços</p>
                <div className="field product-form__name">
                  <label htmlFor="p-name">Nome *</label>
                  <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="product-form__grid product-form__grid--4">
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
                </div>
                <div className="product-form__grid product-form__grid--2">
                  <div className="field">
                    <span className="field-label-text">Lucro (automático)</span>
                    <div className="product-form__profit">
                      {profitBRL(retailPrice, costPrice)}
                      <span className="product-form__profit-meta">
                        Margem sobre venda: {marginOnSalePct(retailPrice, costPrice)}
                      </span>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="p-minstock">Estoque mínimo (ponto de reposição)</label>
                    <input
                      id="p-minstock"
                      type="number"
                      step="1"
                      min="1"
                      value={minStockInput}
                      onChange={(e) => setMinStockInput(e.target.value)}
                    />
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      Cadastro mínimo 1. PDV avisa quando o saldo ficar abaixo deste valor.
                    </span>
                  </div>
                </div>
              </section>

              <div className="modal-wide-split product-form__split">
                <div className="product-form__col">
                  <p className="product-form__section-title">Classificação</p>
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
                  <div className="field field--grow">
                    <label htmlFor="p-desc-c">Descrição</label>
                    <textarea
                      id="p-desc-c"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      placeholder="Descrição complementar (aparece em recibos e relatórios)"
                    />
                  </div>
                </div>
                <div className="product-form__col">
                  <p className="product-form__section-title">Fiscal</p>
                  <details className="submenu-details">
                    <summary className="submenu-summary">Dados fiscais</summary>
                    <div className="submenu-body">
                  <div className="field">
                    <label htmlFor="p-fiscal-sit-create">Situação fiscal (cadastro mestre)</label>
                    <select
                      id="p-fiscal-sit-create"
                      value={fiscalSituationId}
                      onChange={(e) => setFiscalSituationId(e.target.value)}
                    >
                      <option value="">— Apenas campos locais abaixo —</option>
                      {(fiscalSituationsQ.data ?? [])
                        .filter((s) => s.isActive)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} — {s.name}
                          </option>
                        ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      Opcional — <strong>Cadastros gerais → Situação fiscal</strong>.
                    </span>
                  </div>
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
                    </div>
                  </details>
                  <div className="product-form__subsection" aria-label="Unidade tributável e conversão NF-e">
                    <p className="product-form__section-title">Unidade tributável e conversão (NF-e)</p>
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
                  <div className="field">
                    <label htmlFor="p-conversion">Conversão (entrada NF-e)</label>
                    <input
                      id="p-conversion"
                      value={conversion}
                      onChange={(e) => setConversion(e.target.value.toUpperCase())}
                      placeholder="Ex.: CX-12"
                    />
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      Formato <strong>UNIDADE-QUANTIDADE</strong>. Ex.: CX-12 — quando a NF-e vier com unidade CX,
                      o estoque receberá 12 unidades por caixa informada.
                    </span>
                  </div>
                  </div>
                </div>
              </div>

              <section className="product-form__section product-form__section--full" aria-label="Vínculos fornecedor">
                <details className="submenu-details" open>
                  <summary className="submenu-summary">Vínculos com fornecedores (entrada NF-e)</summary>
                  <div className="submenu-body">
                    <ProductSupplierLinksSection
                      idPrefix="p-create"
                      variants={[{ id: '__new__', sku: sku.trim() || '(gerado ao salvar)' }]}
                      links={supplierLinks}
                      onChange={setSupplierLinks}
                    />
                  </div>
                </details>
              </section>
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
        </FormModalBackdrop>
      )}

      {editProduct && editOpen && (
        <FormModalBackdrop
          className="modal-backdrop--wide no-print"
          onClose={() => setEditOpen(false)}
        >
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Alterar produto</h2>
            {editProduct.controlNumber != null && (
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                Código do produto: <strong>{formatProductCode(editProduct.controlNumber)}</strong>
              </p>
            )}
            {err && <div className="alert alert-error">{err}</div>}
            <div className="product-form">
              <section className="product-form__section" aria-label="Identificação">
                <p className="product-form__section-title">Identificação</p>
                <div className="product-form__grid product-form__grid--4">
                  <div className="field" style={{ gridColumn: 'span 2' }}>
                    <label htmlFor="pe-name">Nome *</label>
                    <input id="pe-name" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="field" style={{ gridColumn: 'span 2' }}>
                    <label htmlFor="pe-bar">Código de barras</label>
                    <input
                      id="pe-bar"
                      value={defaultBarcode}
                      onChange={(e) => setDefaultBarcode(e.target.value.trim())}
                      placeholder="EAN do produto"
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </section>

              <div className="modal-wide-split product-form__split">
                <div className="product-form__col">
                  <p className="product-form__section-title">Classificação</p>
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
                  <div className="field field--grow">
                    <label htmlFor="pe-desc">Descrição</label>
                    <textarea
                      id="pe-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      placeholder="Descrição complementar (aparece em recibos e relatórios)"
                    />
                  </div>
                </div>
                <div className="product-form__col">
                  <p className="product-form__section-title">Fiscal</p>
                  <details className="submenu-details">
                    <summary className="submenu-summary">Dados fiscais</summary>
                    <div className="submenu-body">
                  <div className="field">
                    <label htmlFor="p-fiscal-sit-edit">Situação fiscal (cadastro mestre)</label>
                    <select
                      id="p-fiscal-sit-edit"
                      value={fiscalSituationId}
                      onChange={(e) => setFiscalSituationId(e.target.value)}
                    >
                      <option value="">— Apenas campos locais abaixo —</option>
                      {(fiscalSituationsQ.data ?? [])
                        .filter((s) => s.isActive)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} — {s.name}
                          </option>
                        ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      Opcional — <strong>Cadastros gerais → Situação fiscal</strong>.
                    </span>
                  </div>
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
                    </div>
                  </details>
                  <div className="product-form__subsection" aria-label="Unidade tributável e conversão NF-e">
                    <p className="product-form__section-title">Unidade tributável e conversão (NF-e)</p>
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
                  <div className="field">
                    <label htmlFor="pe-conversion">Conversão (entrada NF-e)</label>
                    <input
                      id="pe-conversion"
                      value={conversion}
                      onChange={(e) => setConversion(e.target.value.toUpperCase())}
                      placeholder="Ex.: CX-12"
                    />
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      Formato <strong>UNIDADE-QUANTIDADE</strong>. Ex.: CX-12 — na entrada por NF-e, multiplica a
                      quantidade no estoque quando a unidade da nota coincidir.
                    </span>
                  </div>
                  </div>
                </div>
              </div>

              <section className="product-form__section product-form__section--full" aria-label="Vínculos fornecedor">
                <details className="submenu-details" open>
                  <summary className="submenu-summary">Vínculos com fornecedores (entrada NF-e)</summary>
                  <div className="submenu-body">
                    {editSupplierLinksQ.isLoading && (
                      <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
                        Carregando vínculos…
                      </p>
                    )}
                    <ProductSupplierLinksSection
                      idPrefix="p-edit"
                      variants={editProduct.variants.map((v) => ({ id: v.id, sku: v.sku }))}
                      links={supplierLinks}
                      onChange={setSupplierLinks}
                    />
                  </div>
                </details>
              </section>

              <p
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--color-text-muted)',
                  margin: 0,
                  lineHeight: 1.45,
                }}
              >
                <strong>Controle produto</strong> gravado no cadastro (menor mínimo entre SKUs){' '}
                <strong>{formatStockQty(editProduct.inventoryControlMin ?? '1')}</strong>. Atualiza ao salvar; prévia conforme formulário{' '}
                <strong>{formatStockQty(String(minMinStockFromVariantForm(editProduct.variants, variantPrices)))}</strong>.
              </p>

              <section className="product-form__section" aria-label="Preços por variação">
                <p className="product-form__section-title">Preços por variação (SKU)</p>
                <div className="product-form__variants">
            {editProduct.variants.map((v) => {
              const row = variantPrices[v.id] ?? {
                retail: String(v.retailPrice),
                cost: String(v.costAverage ?? '0'),
                minStock: String(v.minStock ?? '1'),
              };
              return (
                <div key={v.id} className="product-form__variant-row">
                  <div className="field">
                    <span className="field-label-text">SKU</span>
                    <div className="product-form__sku-readonly">{v.sku}</div>
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
                      min="1"
                      value={row.minStock}
                      onChange={(e) =>
                        setVariantPrices((s) => ({ ...s, [v.id]: { ...row, minStock: e.target.value } }))
                      }
                    />
                  </div>
                  <div className="field">
                    <span className="field-label-text">Lucro</span>
                    <div className="product-form__profit">
                      {profitBRL(row.retail, row.cost)}
                      <span className="product-form__profit-meta">
                        Margem: {marginOnSalePct(row.retail, row.cost)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
                </div>
              </section>
            </div>
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
        </FormModalBackdrop>
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
              <div className="product-view-sections">
                <h3 className="product-view-sections__title">Dados do produto</h3>
                <div className="table-wrap">
                  <table className="data-table product-view-table product-view-table--fields">
                    <thead>
                      <tr>
                        <th>Campo</th>
                        <th>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Código</td>
                        <td>{formatProductCode(viewProduct.controlNumber)}</td>
                      </tr>
                      <tr>
                        <td>Nome</td>
                        <td>{viewProduct.name}</td>
                      </tr>
                      <tr>
                        <td>Categoria</td>
                        <td>{viewProduct.category?.name ?? '—'}</td>
                      </tr>
                      <tr>
                        <td>Descrição</td>
                        <td>{viewProduct.description?.trim() ? viewProduct.description : '—'}</td>
                      </tr>
                      <tr>
                        <td>NCM / CEST</td>
                        <td>
                          {viewProduct.ncm ?? '—'} / {viewProduct.cest ?? '—'}
                        </td>
                      </tr>
                      <tr>
                        <td>EX TIPI</td>
                        <td>{viewProduct.exTipi ?? '—'}</td>
                      </tr>
                      <tr>
                        <td>Origem (ICMS)</td>
                        <td>
                          {viewProduct.fiscalOrigin != null && viewProduct.fiscalOrigin !== ''
                            ? FISCAL_ORIGIN_OPTIONS.find((o) => o.value === viewProduct.fiscalOrigin)?.label ??
                              viewProduct.fiscalOrigin
                            : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td>Unidade tributável</td>
                        <td>{viewProduct.taxUnit ?? '—'}</td>
                      </tr>
                      <tr>
                        <td>Status</td>
                        <td>{viewProduct.isActive ? 'Ativo' : 'Inativo'}</td>
                      </tr>
                      <tr>
                        <td>Mín. cadastro (relatórios)</td>
                        <td>
                          {formatStockQty(viewProduct.inventoryControlMin ?? '1')} (menor mínimo entre SKUs
                          cadastradas)
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3 className="product-view-sections__title">Variações (SKU)</h3>
                {viewProduct.variants.length === 0 ? (
                  <p className="product-view-sections__empty">Nenhuma variação cadastrada.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table product-view-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th className="num">Mín.</th>
                          <th className="num">Venda</th>
                          <th className="num">Custo</th>
                          <th className="num">Lucro</th>
                          <th>EAN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewProduct.variants.map((v) => (
                          <tr key={v.id}>
                            <td>{v.sku}</td>
                            <td className="num">{formatStockQty(v.minStock ?? '1')}</td>
                            <td className="num">{formatBRL(v.retailPrice)}</td>
                            <td className="num">{formatBRL(v.costAverage ?? '0')}</td>
                            <td className="num">{profitBRL(String(v.retailPrice), String(v.costAverage ?? '0'))}</td>
                            <td>{v.barcode ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <h3 className="product-view-sections__title">Histórico de preços</h3>
                {priceHistory.isError && (
                  <div className="alert alert-error">{(priceHistory.error as Error).message}</div>
                )}
                {priceHistory.isLoading && <p style={{ fontSize: '0.9rem' }}>Carregando histórico…</p>}
                {!priceHistory.isLoading && !priceHistory.isError && (priceHistory.data?.length ?? 0) === 0 && (
                  <p className="product-view-sections__empty">Nenhuma alteração registrada ainda.</p>
                )}
                {(priceHistory.data?.length ?? 0) > 0 && (
                  <div className="table-wrap" style={{ maxHeight: '240px', overflow: 'auto' }}>
                    <table className="data-table product-view-table">
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
        <FormModalBackdrop className="no-print" onClose={() => setDeleteOpen(false)}>
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
        </FormModalBackdrop>
      )}
    </div>
  );
}
