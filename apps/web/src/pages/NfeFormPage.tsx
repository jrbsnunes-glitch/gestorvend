/**
 * Formulário completo de inclusão/edição de NF-e modelo 55.
 * Cria venda com source=NFE_FORM e enfileira documento NF_E (PDV permanece disponível).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatBRL, formatCpfCnpj } from '../lib/format';

type CustomerRow = {
  id: string;
  name: string;
  document: string | null;
};

type ProductSearchRow = {
  productName: string;
  variantId: string;
  sku: string;
  retailPrice: string;
  taxUnit?: string | null;
};

type Line = {
  key: string;
  variantId: string;
  label: string;
  sku: string;
  quantity: number;
  unitPrice: number;
};

type FiscalDetail = {
  id: string;
  saleId: string;
  status: string;
  kind: string;
  sale: {
    id: string;
    customerId: string | null;
    notes: string | null;
    discount: string;
    surcharge: string;
    items: Array<{
      variantId: string;
      quantity: string;
      unitPrice: string;
      variant?: { sku?: string; product?: { name?: string } };
    }>;
  };
};

const DELETABLE = new Set(['QUEUED', 'ERROR', 'REJECTED', 'BUILDING_XML']);

export function NfeFormPage() {
  const { documentId } = useParams<{ documentId?: string }>();
  const isEdit = Boolean(documentId);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [customerId, setCustomerId] = useState('');
  const [customerQ, setCustomerQ] = useState('');
  const [productQ, setProductQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState('0');
  const [surcharge, setSurcharge] = useState('0');
  const [notes, setNotes] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'PIX' | 'CARD' | 'CREDIT' | 'OTHER'>('CASH');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const existing = useQuery({
    queryKey: ['fiscal', 'documents', documentId],
    queryFn: () => api<FiscalDetail>(`/fiscal/documents/${documentId}`),
    enabled: isEdit && !!documentId,
  });

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    if (!DELETABLE.has(d.status) && d.status !== 'QUEUED') {
      // ainda permite carregar se deletável; senão avisa
    }
    if (!DELETABLE.has(d.status)) {
      setErr('Esta nota não pode ser editada (já enviada/autorizada). Exclua só se ainda não enviada.');
    }
    setCustomerId(d.sale.customerId ?? '');
    setNotes(d.sale.notes ?? '');
    setDiscount(String(d.sale.discount ?? '0'));
    setSurcharge(String(d.sale.surcharge ?? '0'));
    setLines(
      (d.sale.items ?? []).map((it, i) => ({
        key: `${it.variantId}-${i}`,
        variantId: it.variantId,
        label: it.variant?.product?.name ?? 'Produto',
        sku: it.variant?.sku ?? '',
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
      })),
    );
  }, [existing.data]);

  const customers = useQuery({
    queryKey: ['customers', 'nfe-form'],
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

  const selectedCustomer = (customers.data ?? []).find((c) => c.id === customerId) ?? null;

  const productSearch = useQuery({
    queryKey: ['products', 'search', productQ],
    queryFn: () =>
      api<ProductSearchRow[]>(`/products/search?q=${encodeURIComponent(productQ.trim())}`),
    enabled: productQ.trim().length >= 1,
  });

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const disc = Number(String(discount).replace(',', '.')) || 0;
  const sur = Number(String(surcharge).replace(',', '.')) || 0;
  const total = Math.max(0, Math.round((subtotal - disc + sur) * 100) / 100);

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
          label: p.productName,
          sku: p.sku,
          quantity: 1,
          unitPrice: Number(p.retailPrice) || 0,
        },
      ];
    });
    setProductQ('');
  }

  const saveMut = useMutation({
    mutationFn: async (andEmit: boolean) => {
      if (!customerId) throw new Error('Selecione o destinatário (cliente com CPF/CNPJ).');
      const cust = (customers.data ?? []).find((c) => c.id === customerId);
      const docDigits = (cust?.document ?? '').replace(/\D/g, '');
      if (docDigits.length !== 11 && docDigits.length !== 14) {
        throw new Error('NF-e exige cliente com CPF ou CNPJ válido no cadastro.');
      }
      if (!lines.length) throw new Error('Inclua ao menos um item.');
      if (total <= 0) throw new Error('Total da nota deve ser maior que zero.');

      // Edição: remove rascunho anterior (estorna estoque)
      if (isEdit && documentId && existing.data && DELETABLE.has(existing.data.status)) {
        await api(`/fiscal/documents/${documentId}/delete-unsent`, {
          method: 'POST',
          json: {},
        });
      } else if (isEdit && existing.data && !DELETABLE.has(existing.data.status)) {
        throw new Error('Não é possível alterar nota já enviada/autorizada.');
      }

      const sale = await api<{ id: string }>('/sales', {
        method: 'POST',
        json: {
          customerId,
          notes: notes || null,
          discount: disc,
          surcharge: sur,
          source: 'NFE_FORM',
          items: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
          payments: [{ method: payMethod, amount: total }],
        },
      });

      const doc = await api<{ id: string }>('/fiscal/documents/queue', {
        method: 'POST',
        json: { saleId: sale.id, kind: 'NF_E' },
      });

      return { docId: doc.id, andEmit };
    },
    onSuccess: ({ docId, andEmit }) => {
      qc.invalidateQueries({ queryKey: ['fiscal', 'documents'] });
      if (andEmit) {
        window.open(`/notas-fiscais/danfe/${encodeURIComponent(docId)}`, '_blank', 'noopener');
      }
      navigate(`/notas-fiscais?tab=NF_E`);
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="page">
      <h1 className="page-title">{isEdit ? 'Editar NF-e' : 'Incluir NF-e'}</h1>
      <p className="page-desc">
        Formulário completo de NF-e modelo 55. A emissão via PDV continua disponível em Vendas.
      </p>
      <p className="no-print">
        <Link to="/notas-fiscais?tab=NF_E">← Voltar à listagem</Link>
      </p>

      {err && <div className="alert alert-error">{err}</div>}
      {info && <div className="alert alert-success">{info}</div>}
      {existing.isLoading && isEdit && <p>Carregando nota…</p>}

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Destinatário</h2>
        <div className="field">
          <label htmlFor="nfe-cli-q">Buscar cliente</label>
          <input
            id="nfe-cli-q"
            value={customerQ}
            onChange={(e) => setCustomerQ(e.target.value)}
            placeholder="Nome ou CPF/CNPJ"
          />
        </div>
        <div className="field">
          <label htmlFor="nfe-cli">Cliente *</label>
          <select
            id="nfe-cli"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">— Selecione —</option>
            {customerHits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.document ? ` — ${formatCpfCnpj(c.document)}` : ' (sem documento)'}
              </option>
            ))}
          </select>
        </div>
        {selectedCustomer && (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Documento: {selectedCustomer.document ? formatCpfCnpj(selectedCustomer.document) : '—'}
          </p>
        )}
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Itens</h2>
        <div className="field">
          <label htmlFor="nfe-prod">Produto (busca)</label>
          <input
            id="nfe-prod"
            value={productQ}
            onChange={(e) => setProductQ(e.target.value)}
            placeholder="Nome, SKU ou código de barras"
          />
        </div>
        {productSearch.data && productSearch.data.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
            {productSearch.data.slice(0, 12).map((p) => (
              <li key={p.variantId} style={{ marginBottom: '0.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={() => addProduct(p)}
                >
                  + {p.productName} ({p.sku}) — {formatBRL(p.retailPrice)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="table-wrap">
          <table className="data-table">
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
                    <input
                      style={{ width: '4.5rem', textAlign: 'right' }}
                      value={l.quantity}
                      onChange={(e) => {
                        const n = Number(String(e.target.value).replace(',', '.')) || 0;
                        setLines((prev) =>
                          prev.map((x) => (x.key === l.key ? { ...x, quantity: n } : x)),
                        );
                      }}
                    />
                  </td>
                  <td className="num">
                    <input
                      style={{ width: '6rem', textAlign: 'right' }}
                      value={l.unitPrice}
                      onChange={(e) => {
                        const n = Number(String(e.target.value).replace(',', '.')) || 0;
                        setLines((prev) =>
                          prev.map((x) => (x.key === l.key ? { ...x, unitPrice: n } : x)),
                        );
                      }}
                    />
                  </td>
                  <td className="num">{formatBRL(l.quantity * l.unitPrice)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger btn-compact"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-row form-row--3" style={{ marginTop: '0.75rem' }}>
          <div className="field">
            <label htmlFor="nfe-disc">Desconto (R$)</label>
            <input id="nfe-disc" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nfe-sur">Acréscimo (R$)</label>
            <input id="nfe-sur" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} />
          </div>
          <div className="field">
            <label>Total</label>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', paddingTop: '0.35rem' }}>
              {formatBRL(total)}
            </div>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Pagamento e observações</h2>
        <div className="form-row form-row--2">
          <div className="field">
            <label htmlFor="nfe-pay">Forma</label>
            <select
              id="nfe-pay"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
            >
              <option value="CASH">Dinheiro</option>
              <option value="PIX">Pix</option>
              <option value="CARD">Cartão</option>
              <option value="CREDIT">Crediário</option>
              <option value="OTHER">Outro</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="nfe-notes">Observações</label>
            <input id="nfe-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </section>

      <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/notas-fiscais?tab=NF_E')}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saveMut.isPending}
          onClick={() => {
            setErr(null);
            setInfo(null);
            saveMut.mutate(false);
          }}
        >
          {saveMut.isPending ? 'Salvando…' : 'Salvar (fila)'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saveMut.isPending}
          onClick={() => {
            setErr(null);
            setInfo('Abrindo DANFE em nova aba…');
            saveMut.mutate(true);
          }}
        >
          Salvar e emitir (DANFE)
        </button>
      </div>
    </div>
  );
}
