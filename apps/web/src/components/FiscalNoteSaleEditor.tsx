/**
 * Edição de cliente e itens no modal "Cadastro da nota" (antes de reenviar à SEFAZ).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { NumericInput } from './NumericInput';
import { ProductSearchModal, type ProductSearchRow } from './ProductSearchModal';
import { api } from '../lib/api';
import { openCustomerCadastro, openProductCadastro } from '../lib/cadastro-edit-window';
import { formatBRL, formatCpfCnpj } from '../lib/format';

type CustomerRow = { id: string; name: string; document: string | null };

type SaleItemRow = {
  variantId: string;
  quantity: string;
  unitPrice: string;
  variant?: { sku?: string; product?: { id?: string; name?: string } };
};

type EditorDoc = {
  id: string;
  kind: string;
  status: string;
  lastError?: string | null;
  sale: {
    customerId: string | null;
    customer?: { name: string } | null;
    items?: SaleItemRow[];
  };
};

type Line = {
  key: string;
  variantId: string;
  productId: string;
  label: string;
  sku: string;
  quantity: number;
  unitPrice: number;
};

export function canEditFiscalNoteSaleContent(status: string): boolean {
  return status !== 'AUTHORIZED' && status !== 'CANCELLED';
}

export function FiscalNoteSaleEditor({
  doc,
  onSaved,
}: {
  doc: EditorDoc;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState(doc.sale.customerId ?? '');
  const [customerQ, setCustomerQ] = useState('');
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    setCustomerId(doc.sale.customerId ?? '');
    setLines(
      (doc.sale.items ?? []).map((it, i) => ({
        key: `${it.variantId}-${i}`,
        variantId: it.variantId,
        productId: it.variant?.product?.id ?? '',
        label: it.variant?.product?.name ?? 'Produto',
        sku: it.variant?.sku ?? '',
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
      })),
    );
  }, [doc.id, doc.sale.customerId, doc.sale.items]);

  const customers = useQuery({
    queryKey: ['customers', 'fiscal-note-editor'],
    queryFn: () => api<CustomerRow[]>('/customers'),
  });

  const customerHits = useMemo(() => {
    const q = customerQ.trim().toLowerCase();
    const all = customers.data ?? [];
    if (!q) return all.slice(0, 40);
    return all
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.document ?? '').includes(q.replace(/\D/g, '')),
      )
      .slice(0, 40);
  }, [customers.data, customerQ]);

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  function addProduct(p: ProductSearchRow) {
    setLines((prev) => {
      const found = prev.find((l) => l.variantId === p.variantId);
      if (found) {
        return prev.map((l) =>
          l.variantId === p.variantId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          key: `${p.variantId}-${Date.now()}`,
          variantId: p.variantId,
          productId: p.productId,
          label: p.productName,
          sku: p.sku,
          quantity: 1,
          unitPrice: Number(p.retailPrice) || 0,
        },
      ];
    });
    setProductSearchOpen(false);
  }

  const saveMut = useMutation({
    mutationFn: () =>
      api(`/fiscal/documents/${doc.id}/sale-content`, {
        method: 'PATCH',
        json: {
          customerId: customerId || null,
          items: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: 0,
          })),
        },
      }),
    onSuccess: () => {
      setLocalErr(null);
      void qc.invalidateQueries({ queryKey: ['fiscal', 'documents'] });
      void qc.invalidateQueries({ queryKey: ['fiscal', 'documents', doc.id] });
      onSaved?.();
    },
    onError: (e: Error) => setLocalErr(e.message),
  });

  const needsCustomer = doc.kind === 'NF_E';

  return (
    <section className="card" style={{ marginTop: '0.75rem' }}>
      <h3 style={{ fontSize: '0.95rem', marginTop: 0 }}>Ajustar cliente e produtos</h3>
      <p className="page-desc" style={{ marginTop: 0, fontSize: '0.82rem' }}>
        Corrija destinatário ou itens após rejeição da SEFAZ e salve antes de reenviar. Use{' '}
        <strong>Editar cadastro</strong> para abrir cliente ou produto (endereço, NCM, situação
        fiscal etc.) em nova aba, ajuste e volte aqui para reenviar.
      </p>
      {doc.lastError ? (
        <div className="alert alert-error" style={{ fontSize: '0.85rem' }}>
          {doc.lastError}
        </div>
      ) : null}
      {localErr ? <div className="alert alert-error">{localErr}</div> : null}

      <div className="nfe-field-row" style={{ marginBottom: '0.75rem' }}>
        <div className="field field--grow">
          <label htmlFor="fnote-cli-q">Buscar cliente</label>
          <input
            id="fnote-cli-q"
            value={customerQ}
            onChange={(e) => setCustomerQ(e.target.value)}
            placeholder="Nome ou CPF/CNPJ"
          />
        </div>
        <div className="field field--grow-lg">
          <label htmlFor="fnote-cli">
            Cliente{needsCustomer ? ' *' : ' (opcional na NFC-e)'}
          </label>
          <select id="fnote-cli" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— {needsCustomer ? 'Selecione' : 'Consumidor'} —</option>
            {customerHits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.document ? ` — ${formatCpfCnpj(c.document)}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--action">
          <span className="field-label-spacer" aria-hidden="true">
            Cadastro
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!customerId}
            title={customerId ? 'Abre o cadastro do cliente em nova aba' : 'Selecione um cliente'}
            onClick={() => customerId && openCustomerCadastro(customerId)}
          >
            Editar cadastro
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setProductSearchOpen(true)}
        >
          Pesquisar / incluir produto
        </button>
      </div>
      <ProductSearchModal
        open={productSearchOpen}
        title="Produto na nota"
        onClose={() => setProductSearchOpen(false)}
        onPick={addProduct}
        onEdit={(row) => openProductCadastro(row.productId, 'fiscal')}
      />

      <div className="table-wrap">
        <table className="data-table data-table--no-cards">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Qtd</th>
              <th className="num">Unit.</th>
              <th className="num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!lines.length && (
              <tr>
                <td colSpan={5} className="empty">
                  Nenhum item.
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.key}>
                <td>
                  <strong>{l.label}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{l.sku}</div>
                </td>
                <td className="num">
                  <NumericInput
                    style={{ width: '4.5rem', textAlign: 'right' }}
                    min={0.001}
                    blurEmpty={1}
                    value={l.quantity}
                    onChange={(_raw, n) => {
                      if (n == null) return;
                      setLines((prev) =>
                        prev.map((x) => (x.key === l.key ? { ...x, quantity: n } : x)),
                      );
                    }}
                  />
                </td>
                <td className="num">
                  <NumericInput
                    style={{ width: '6rem', textAlign: 'right' }}
                    min={0}
                    blurEmpty={0}
                    value={l.unitPrice}
                    onChange={(_raw, n) => {
                      if (n == null) return;
                      setLines((prev) =>
                        prev.map((x) => (x.key === l.key ? { ...x, unitPrice: n } : x)),
                      );
                    }}
                  />
                </td>
                <td className="num">{formatBRL(l.quantity * l.unitPrice)}</td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-end' }}>
                    {l.productId ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() => openProductCadastro(l.productId, 'fiscal')}
                      >
                        Cadastro
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-danger btn-compact"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                    >
                      Remover
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ margin: '0.5rem 0 0', fontWeight: 600 }}>Subtotal itens: {formatBRL(subtotal)}</p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saveMut.isPending || (needsCustomer && !customerId) || lines.length === 0}
          onClick={() => {
            setLocalErr(null);
            saveMut.mutate();
          }}
        >
          {saveMut.isPending ? 'Salvando…' : 'Salvar alterações'}
        </button>
        {doc.kind === 'NF_E' && (
          <Link
            className="btn btn-secondary"
            to={`/notas-fiscais/nfe/${encodeURIComponent(doc.id)}/editar`}
          >
            Formulário NF-e completo
          </Link>
        )}
      </div>
    </section>
  );
}
