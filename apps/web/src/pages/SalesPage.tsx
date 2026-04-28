import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';

type Sale = {
  id: string;
  number: number;
  status: string;
  total: string;
  createdAt: string;
  customer: { name: string } | null;
};

type Line = { variantId: string; quantity: string; unitPrice: string };

const PAY_METHODS = ['CASH', 'CARD', 'PIX', 'CREDIT', 'OTHER'] as const;

export function SalesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState('0');
  const [lines, setLines] = useState<Line[]>([{ variantId: '', quantity: '1', unitPrice: '0' }]);
  const [payMethod, setPayMethod] = useState<(typeof PAY_METHODS)[number]>('CASH');
  const [payInstallments, setPayInstallments] = useState('1');
  const [err, setErr] = useState<string | null>(null);

  const sales = useQuery({
    queryKey: ['sales'],
    queryFn: () => api<Sale[]>('/sales'),
  });

  const customers = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/customers'),
  });

  const variantOptions = useQuery({
    queryKey: ['products-for-select'],
    queryFn: async () => {
      const products = await api<Array<{ name: string; variants: Array<{ id: string; sku: string; retailPrice: string }> }>>(
        '/products',
      );
      return products.flatMap((p) =>
        p.variants.map((v) => ({
          id: v.id,
          label: `${v.sku} — ${p.name}`,
          defaultPrice: v.retailPrice,
        })),
      );
    },
  });

  const subtotal = useMemo(() => {
    let s = 0;
    for (const l of lines) {
      const q = parseFloat(l.quantity.replace(',', '.')) || 0;
      const p = parseFloat(l.unitPrice.replace(',', '.')) || 0;
      s += q * p;
    }
    return s;
  }, [lines]);

  const total = Math.max(0, subtotal - (parseFloat(discount.replace(',', '.')) || 0));

  const create = useMutation({
    mutationFn: () =>
      api('/sales', {
        method: 'POST',
        json: {
          customerId: customerId || null,
          discount: parseFloat(discount.replace(',', '.')) || 0,
          items: lines
            .filter((l) => l.variantId)
            .map((l) => ({
              variantId: l.variantId,
              quantity: parseFloat(l.quantity.replace(',', '.')) || 0,
              unitPrice: parseFloat(l.unitPrice.replace(',', '.')) || 0,
            })),
          payments: [{ method: payMethod, amount: total, installments: parseInt(payInstallments, 10) || 1 }],
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['reports', 'sales-summary'] });
      setOpen(false);
      setCustomerId('');
      setDiscount('0');
      setLines([{ variantId: '', quantity: '1', unitPrice: '0' }]);
      setPayMethod('CASH');
      setPayInstallments('1');
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api(`/sales/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['reports', 'sales-summary'] });
    },
  });

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function onVariantPick(i: number, id: string) {
    const v = variantOptions.data?.find((x) => x.id === id);
    setLine(i, {
      variantId: id,
      unitPrice: v ? String(parseFloat(v.defaultPrice) || 0) : '0',
    });
  }

  return (
    <div className="page">
      <h1 className="page-title">Vendas</h1>
      <p className="page-desc">Registro de vendas com baixa no estoque do local padrão.</p>

      <div className="toolbar">
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          Últimas {sales.data?.length ?? 0} venda(s)
        </span>
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Nova venda
        </button>
      </div>

      {sales.isError && <div className="alert alert-error">{(sales.error as Error).message}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Data</th>
              <th>Cliente</th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sales.isLoading && (
              <tr>
                <td colSpan={6} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!sales.isLoading && !sales.data?.length && (
              <tr>
                <td colSpan={6} className="empty">
                  Nenhuma venda registrada.
                </td>
              </tr>
            )}
            {sales.data?.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>#{s.number}</strong>
                </td>
                <td style={{ fontSize: '0.88rem' }}>{formatDate(s.createdAt)}</td>
                <td>{s.customer?.name ?? '—'}</td>
                <td>{formatBRL(s.total)}</td>
                <td>
                  <span
                    className={
                      'badge ' +
                      (s.status === 'COMPLETED'
                        ? 'badge-success'
                        : s.status === 'CANCELLED'
                          ? 'badge-danger'
                          : 'badge-muted')
                    }
                  >
                    {s.status}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {s.status === 'COMPLETED' && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '0.82rem', padding: '0.25rem 0.5rem' }}
                      disabled={cancelMut.isPending}
                      onClick={() => {
                        if (confirm('Cancelar esta venda e estornar estoque?')) cancelMut.mutate(s.id);
                      }}
                    >
                      Cancelar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>Nova venda</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
              Total: <strong>{formatBRL(total)}</strong> — confira estoque no local padrão antes de salvar.
            </p>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="field">
              <label htmlFor="sale-client">Cliente (opcional)</label>
              <select id="sale-client" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— Balcão —</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sale-disc">Desconto global (R$)</label>
              <input id="sale-disc" value={discount} onChange={(e) => setDiscount(e.target.value)} type="number" step="0.01" min="0" />
            </div>

            <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.5rem' }}>Itens</h3>
            {lines.map((l, i) => (
              <div key={i} className="form-row" style={{ alignItems: 'flex-end', marginBottom: '0.5rem' }}>
                <div className="field" style={{ flex: 2, marginBottom: 0 }}>
                  <label>SKU / produto</label>
                  <select value={l.variantId} onChange={(e) => onVariantPick(i, e.target.value)}>
                    <option value="">— Selecione —</option>
                    {variantOptions.data?.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Qtd</label>
                  <input value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Unit.</label>
                  <input value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={lines.length <= 1}
                  onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginBottom: '1rem' }}
              onClick={() => setLines((p) => [...p, { variantId: '', quantity: '1', unitPrice: '0' }])}
            >
              + Linha
            </button>

            <div className="form-row">
              <div className="field">
                <label htmlFor="pay-m">Pagamento</label>
                <select id="pay-m" value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}>
                  {PAY_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              {payMethod === 'CREDIT' && (
                <div className="field">
                  <label htmlFor="pay-n">Parcelas</label>
                  <input id="pay-n" value={payInstallments} onChange={(e) => setPayInstallments(e.target.value)} min={1} type="number" />
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                Fechar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!lines.some((l) => l.variantId) || total <= 0 || create.isPending}
                onClick={() => create.mutate()}
              >
                Finalizar venda
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
