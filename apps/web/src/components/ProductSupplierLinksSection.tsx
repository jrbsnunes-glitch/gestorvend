import { SupplierSearchCombo } from './ProductCatalogCombos';

export type SupplierLinkDraft = {
  supplierId: string;
  supplierName: string;
  variantId: string;
  supplierProductCode: string;
};

type VariantOption = { id: string; sku: string };

type Props = {
  variants: VariantOption[];
  links: SupplierLinkDraft[];
  onChange: (links: SupplierLinkDraft[]) => void;
  idPrefix: string;
};

function emptyLink(variantId: string): SupplierLinkDraft {
  return {
    supplierId: '',
    supplierName: '',
    variantId,
    supplierProductCode: '',
  };
}

export function ProductSupplierLinksSection({ variants, links, onChange, idPrefix }: Props) {
  const defaultVariantId = variants[0]?.id ?? '';

  function setLink(i: number, patch: Partial<SupplierLinkDraft>) {
    onChange(links.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  function addLink() {
    if (!defaultVariantId) return;
    onChange([...links, emptyLink(defaultVariantId)]);
  }

  function removeLink(i: number) {
    onChange(links.filter((_, j) => j !== i));
  }

  if (!variants.length) {
    return (
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Salve o produto com ao menos uma variação (SKU) para configurar vínculos com fornecedores.
      </p>
    );
  }

  return (
    <div className="product-supplier-links">
      <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
        Informe o <strong>código do produto no fornecedor</strong> (cProd da NF-e) para que entradas futuras
        identifiquem este SKU automaticamente ao importar a nota pela chave.
      </p>
      {links.length === 0 ? (
        <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
          Nenhum vínculo cadastrado. Adicione o fornecedor e o código usado nas notas dele.
        </p>
      ) : (
        <div className="table-wrap product-supplier-links__table-wrap">
          <table className="data-table product-supplier-links__table">
            <thead>
              <tr>
                <th>Fornecedor</th>
                {variants.length > 1 && <th>SKU</th>}
                <th>Cód. no fornecedor (cProd)</th>
                <th style={{ width: 48 }}></th>
              </tr>
            </thead>
            <tbody>
              {links.map((link, i) => (
                <tr key={i}>
                  <td>
                    <SupplierSearchCombo
                      id={`${idPrefix}-sup-${i}`}
                      value={link.supplierId}
                      hintName={link.supplierName}
                      onChange={(id, picked) => {
                        setLink(i, {
                          supplierId: id,
                          supplierName: picked ?? (id ? link.supplierName : ''),
                        });
                      }}
                    />
                  </td>
                  {variants.length > 1 && (
                    <td>
                      <select
                        value={link.variantId || defaultVariantId}
                        onChange={(e) => setLink(i, { variantId: e.target.value })}
                      >
                        {variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.sku}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td>
                    <input
                      value={link.supplierProductCode}
                      onChange={(e) => setLink(i, { supplierProductCode: e.target.value })}
                      placeholder="Ex.: 12345, PROD-ABC"
                      maxLength={60}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      title="Remover vínculo"
                      onClick={() => removeLink(i)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={addLink}>
        + Vínculo com fornecedor
      </button>
    </div>
  );
}

export function draftLinksFromApi(
  rows: Array<{
    supplierId: string;
    variantId: string;
    supplierProductCode: string;
    supplier: { legalName: string };
  }>,
): SupplierLinkDraft[] {
  return rows.map((r) => ({
    supplierId: r.supplierId,
    supplierName: r.supplier.legalName,
    variantId: r.variantId,
    supplierProductCode: r.supplierProductCode,
  }));
}

export function linksToPayload(links: SupplierLinkDraft[]) {
  return links
    .filter((l) => l.supplierId.trim() && l.supplierProductCode.trim() && l.variantId)
    .map((l) => ({
      supplierId: l.supplierId.trim(),
      variantId: l.variantId,
      supplierProductCode: l.supplierProductCode.trim(),
    }));
}

export function linksToCreatePayload(links: SupplierLinkDraft[]) {
  return links
    .filter((l) => l.supplierId.trim() && l.supplierProductCode.trim())
    .map((l) => ({
      supplierId: l.supplierId.trim(),
      supplierProductCode: l.supplierProductCode.trim(),
    }));
}
