import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';

export type ProductSearchRow = {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  barcode: string | null;
  retailPrice: string;
  costAverage: string;
  stockTotal: string;
};

type Props = {
  open: boolean;
  title?: string;
  onClose: () => void;
  onPick: (row: ProductSearchRow) => void;
};

export function ProductSearchModal({ open, title = 'Pesquisar produto', onClose, onPick }: Props) {
  const [searchInput, setSearchInput] = useState('');
  const searchQ = useDeferredValue(searchInput.trim());

  const productSearch = useQuery({
    queryKey: ['products', 'search', searchQ],
    queryFn: () => api<ProductSearchRow[]>(`/products/search?q=${encodeURIComponent(searchQ)}`),
    enabled: open && searchQ.length >= 1,
    staleTime: 5_000,
  });

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-labelledby="product-search-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="product-search-modal-title">{title}</h2>
        <div className="field">
          <label htmlFor="product-search-modal-q">Nome, SKU ou código de barras</label>
          <input
            id="product-search-modal-q"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            autoFocus
            placeholder="Digite para pesquisar…"
          />
        </div>
        {productSearch.isError && (
          <div className="alert alert-error">{(productSearch.error as Error).message}</div>
        )}
        <div className="table-wrap" style={{ maxHeight: 'min(50vh, 420px)', overflow: 'auto' }}>
          <table className="data-table products-search-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>SKU</th>
                <th className="num col-money">Venda</th>
                <th className="num col-money">Custo</th>
                <th style={{ width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {searchQ.length < 1 && (
                <tr>
                  <td colSpan={5} className="empty">
                    Informe um termo para pesquisar.
                  </td>
                </tr>
              )}
              {searchQ.length >= 1 && productSearch.isPending && (
                <tr>
                  <td colSpan={5} className="empty">
                    Pesquisando…
                  </td>
                </tr>
              )}
              {searchQ.length >= 1 &&
                !productSearch.isPending &&
                Array.isArray(productSearch.data) &&
                productSearch.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                )}
              {(productSearch.data ?? []).map((row) => (
                <tr key={row.variantId}>
                  <td>{row.productName}</td>
                  <td>{row.sku}</td>
                  <td className="num col-money">{formatBRL(row.retailPrice)}</td>
                  <td className="num col-money">{formatBRL(row.costAverage)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        onPick(row);
                        onClose();
                      }}
                    >
                      Selecionar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
