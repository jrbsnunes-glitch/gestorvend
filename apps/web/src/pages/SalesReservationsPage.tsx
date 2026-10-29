import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { NumericInput } from '../components/NumericInput';
import { ProductSearchModal, type ProductSearchRow } from '../components/ProductSearchModal';
import { RecordViewModal, type RecordViewSection } from '../components/RecordViewModal';
import { api } from '../lib/api';
import { formatBRL, formatDate, formatStockQty } from '../lib/format';
import {
  isCustomerCreditKind,
  PAYMENT_FORM_KIND_LABELS,
  type PaymentForm,
} from '../lib/payment-forms';
import { openReservationReceipt } from '../lib/sales-reservation-print';
import './sales-reservations.css';

type CustomerSearchRow = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
};

type CartLine = {
  variantId: string;
  productName: string;
  sku: string;
  barcode?: string | null;
  unitPrice: number;
  quantity: number;
  isService?: boolean;
};

type Reservation = {
  id: string;
  number: number;
  status: 'OPEN' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
  customerId: string | null;
  notes: string | null;
  subtotal: string;
  total: string;
  expiresAt: string;
  createdAt: string;
  customer: { id: string; name: string } | null;
  user: { id: string; name: string } | null;
  sale: { id: string; number: number; status: string } | null;
  items: Array<{
    variantId: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    totalLine: string;
    variant: { sku: string; product: { name: string; isService?: boolean } };
  }>;
  payments: Array<{
    method: string;
    amount: string;
    installments: number;
    paymentFormId: string | null;
    paymentForm: { id: string; name: string; kind: string } | null;
  }>;
};

type OpenCash = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  controlNumber?: number;
  openedAt: string;
  user: { id: string; name: string } | null;
};

const STATUS_LABEL: Record<Reservation['status'], string> = {
  OPEN: 'Aberta',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Expirada',
};

const STATUS_BADGE: Record<Reservation['status'], string> = {
  OPEN: 'badge badge-warn',
  CONFIRMED: 'badge badge-success',
  CANCELLED: 'badge badge-danger',
  EXPIRED: 'badge badge-muted',
};

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyForm(): {
  customer: CustomerSearchRow | null;
  lines: CartLine[];
  notes: string;
  paymentFormId: string;
  installments: number;
} {
  return { customer: null, lines: [], notes: '', paymentFormId: '', installments: 1 };
}

export function SalesReservationsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productQ, setProductQ] = useState('');
  const [customerQ, setCustomerQ] = useState('');
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [printPrompt, setPrintPrompt] = useState<{ id: string; number: number } | null>(null);
  const [viewRow, setViewRow] = useState<Reservation | null>(null);
  const [confirmRow, setConfirmRow] = useState<Reservation | null>(null);
  const [cashId, setCashId] = useState('');

  const listQ = useQuery({
    queryKey: ['sales-reservations'],
    queryFn: () => api<Reservation[]>('/sales-reservations'),
  });
  const formsQ = useQuery({
    queryKey: ['payment-forms', 'active'],
    queryFn: () => api<PaymentForm[]>('/payment-forms?active=1'),
  });
  const productsSearch = useQuery({
    queryKey: ['products', 'search', productQ],
    queryFn: () =>
      api<ProductSearchRow[]>(`/products/search?q=${encodeURIComponent(productQ.trim())}`),
    enabled: productQ.trim().length >= 1,
  });
  const customersSearch = useQuery({
    queryKey: ['customers', 'search', customerQ],
    queryFn: () =>
      api<CustomerSearchRow[]>(`/customers/search?q=${encodeURIComponent(customerQ.trim())}`),
    enabled: customerQ.trim().length >= 1,
  });
  const openCashQ = useQuery({
    queryKey: ['cash', 'sessions', 'OPEN'],
    queryFn: () => api<OpenCash[]>('/cash/sessions?status=OPEN'),
    enabled: Boolean(confirmRow),
  });

  const forms = formsQ.data ?? [];
  const selectedForm = forms.find((f) => f.id === form.paymentFormId) ?? forms[0] ?? null;

  useEffect(() => {
    if (!form.paymentFormId && forms[0]) {
      setForm((p) => ({ ...p, paymentFormId: forms[0]!.id }));
    }
  }, [forms, form.paymentFormId]);
  const subtotal = money(form.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const total = subtotal;
  const needsCustomer = selectedForm ? isCustomerCreditKind(selectedForm.kind) : false;

  function resetForm() {
    setForm(emptyForm());
    setEditingId(null);
    setProductQ('');
    setCustomerQ('');
  }

  function addProduct(p: ProductSearchRow & { promoPrice?: string | null }) {
    const price = Number(p.promoPrice ?? p.retailPrice) || 0;
    setForm((prev) => {
      const found = prev.lines.find((l) => l.variantId === p.variantId);
      if (found) {
        return {
          ...prev,
          lines: prev.lines.map((l) =>
            l.variantId === p.variantId ? { ...l, quantity: money(l.quantity + 1) } : l,
          ),
        };
      }
      return {
        ...prev,
        lines: [
          ...prev.lines,
          {
            variantId: p.variantId,
            productName: p.productName,
            sku: p.sku,
            barcode: p.barcode,
            unitPrice: price,
            quantity: 1,
            isService: p.isService,
          },
        ],
      };
    });
    setProductQ('');
    setProductSearchOpen(false);
  }

  function setLineQty(variantId: string, qty: number) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((x) => (x.variantId === variantId ? { ...x, quantity: qty } : x)),
    }));
  }

  function bumpQty(variantId: string, delta: number) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.flatMap((l) => {
        if (l.variantId !== variantId) return [l];
        const next = money(l.quantity + delta);
        if (next < 0.001) return [];
        return [{ ...l, quantity: next }];
      }),
    }));
  }

  function addFirstProductHit() {
    const hits = productsSearch.data ?? [];
    if (hits[0]) addProduct(hits[0]);
  }

  function loadReservation(row: Reservation) {
    setEditingId(row.id);
    setForm({
      customer: row.customer
        ? { id: row.customer.id, name: row.customer.name, document: null, phone: null }
        : null,
      notes: row.notes ?? '',
      paymentFormId: row.payments[0]?.paymentFormId ?? row.payments[0]?.paymentForm?.id ?? '',
      installments: row.payments[0]?.installments ?? 1,
      lines: row.items.map((it) => ({
        variantId: it.variantId,
        productName: it.variant.product.name,
        sku: it.variant.sku,
        barcode: null,
        unitPrice: Number(it.unitPrice),
        quantity: Number(it.quantity),
        isService: it.variant.product.isService,
      })),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.lines.length) throw new Error('Inclua ao menos um produto.');
      const payForm = selectedForm;
      if (!payForm) throw new Error('Cadastre ou escolha uma forma de pagamento.');
      if (needsCustomer && !form.customer) {
        throw new Error('Crediário e requisição exigem um cliente cadastrado.');
      }
      const payload = {
        customerId: form.customer?.id ?? null,
        notes: form.notes.trim() || null,
        items: form.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
        payments: [
          {
            paymentFormId: payForm.id,
            method: payForm.kind,
            amount: total,
            installments: form.installments,
          },
        ],
      };
      if (editingId) {
        return api<Reservation>(`/sales-reservations/${editingId}`, {
          method: 'PATCH',
          json: payload,
        });
      }
      return api<Reservation>('/sales-reservations', { method: 'POST', json: payload });
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['sales-reservations'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      setToast({
        kind: 'ok',
        text: editingId ? `Reserva #${row.number} atualizada.` : `Reserva #${row.number} gravada.`,
      });
      resetForm();
      setPrintPrompt({ id: row.id, number: row.number });
    },
    onError: (e: Error) => setToast({ kind: 'err', text: e.message }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) =>
      api<Reservation>(`/sales-reservations/${id}/cancel`, { method: 'POST' }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['sales-reservations'] });
      setToast({ kind: 'ok', text: `Reserva #${row.number} cancelada. Estoque devolvido.` });
    },
    onError: (e: Error) => setToast({ kind: 'err', text: e.message }),
  });

  const confirmMut = useMutation({
    mutationFn: () => {
      if (!confirmRow) throw new Error('Selecione a reserva.');
      if (!cashId) throw new Error('Selecione o caixa aberto.');
      return api<{ reservation: Reservation; sale: { id: string; number: number } }>(
        `/sales-reservations/${confirmRow.id}/confirm`,
        { method: 'POST', json: { cashSessionId: cashId } },
      );
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['sales-reservations'] });
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['cash'] });
      setConfirmRow(null);
      setCashId('');
      setToast({
        kind: 'ok',
        text: `Reserva #${data.reservation.number} confirmada como venda #${data.sale.number}.`,
      });
    },
    onError: (e: Error) => setToast({ kind: 'err', text: e.message }),
  });

  const rows = listQ.data ?? [];
  const openRows = useMemo(() => rows.filter((r) => r.status === 'OPEN'), [rows]);

  const viewSections: RecordViewSection[] = viewRow
    ? [
        {
          title: 'Reserva',
          fields: [
            { label: 'Número', value: `#${viewRow.number}` },
            { label: 'Status', value: STATUS_LABEL[viewRow.status] },
            { label: 'Cliente', value: viewRow.customer?.name ?? 'Cliente Balcão' },
            { label: 'Validade', value: formatDate(viewRow.expiresAt) },
            { label: 'Subtotal', value: formatBRL(viewRow.subtotal) },
            { label: 'Total', value: formatBRL(viewRow.total) },
            {
              label: 'Pagamento',
              value:
                viewRow.payments
                  .map(
                    (p) =>
                      `${p.paymentForm?.name || p.method} ${formatBRL(p.amount)}${
                        p.installments > 1 ? ` (${p.installments}x)` : ''
                      }`,
                  )
                  .join(', ') || '—',
            },
            { label: 'Observação', value: viewRow.notes || '—' },
            {
              label: 'Venda',
              value: viewRow.sale ? `#${viewRow.sale.number}` : '—',
            },
          ],
        },
        {
          title: 'Itens',
          empty: 'Nenhum item.',
          columns: [
            'Produto',
            { label: 'Qtd', num: true },
            { label: 'Unitário', num: true },
            { label: 'Total', num: true },
          ],
          rows: viewRow.items.map((it) => [
            `${it.variant.product.name} (${it.variant.sku})`,
            formatStockQty(it.quantity),
            formatBRL(it.unitPrice),
            formatBRL(it.totalLine),
          ]),
        },
      ]
    : [];

  return (
    <div className="page gv-reservation-page">
      <h1 className="page-title">Reserva de Vendas</h1>
      <p className="page-desc">
        Separa o estoque no local Reserva por até 24 horas. Confirme em um caixa aberto do dia.
      </p>

      {toast ? (
        <div className={`alert ${toast.kind === 'ok' ? 'alert-success' : 'alert-error'}`} role="status">
          <div className="gv-reservation-alert-actions">
            <span>{toast.text}</span>
            <button type="button" className="btn btn-ghost btn-compact" onClick={() => setToast(null)}>
              Fechar
            </button>
          </div>
        </div>
      ) : null}

      {printPrompt ? (
        <div className="alert alert-success" role="status">
          <div className="gv-reservation-alert-actions">
            <span>Reserva #{printPrompt.number} gravada. Imprimir comprovante?</span>
            <button
              type="button"
              className="btn btn-primary btn-compact"
              onClick={() => {
                openReservationReceipt(printPrompt.id);
                setPrintPrompt(null);
              }}
            >
              Imprimir
            </button>
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => setPrintPrompt(null)}>
              Não
            </button>
          </div>
        </div>
      ) : null}

      <section className="card no-print">
        <h2 className="page-title">{editingId ? 'Editar reserva' : 'Nova reserva'}</h2>

        <div className="form-row">
          <div className="field">
            <label>Cliente</label>
            {form.customer ? (
              <div className="gv-reservation-picked">
                <input readOnly value={form.customer.name} />
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={() => {
                    setForm((p) => ({ ...p, customer: null }));
                    setCustomerQ('');
                  }}
                >
                  Trocar
                </button>
              </div>
            ) : (
              <input
                type="search"
                placeholder="Vazio = Cliente Balcão"
                value={customerQ}
                onChange={(e) => setCustomerQ(e.target.value)}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="rsv-pay">Forma de pagamento *</label>
            <select
              id="rsv-pay"
              value={selectedForm?.id ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, paymentFormId: e.target.value, installments: 1 }))}
            >
              {forms.length === 0 ? <option value="">Nenhuma forma ativa</option> : null}
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} — {PAYMENT_FORM_KIND_LABELS[f.kind]}
                </option>
              ))}
            </select>
          </div>
          {selectedForm && (selectedForm.kind === 'CARD' || selectedForm.kind === 'REQUISITION') ? (
            <div className="field">
              <label htmlFor="rsv-inst">Parcelas</label>
              <NumericInput
                id="rsv-inst"
                integer
                min={1}
                max={selectedForm.maxInstallments || 48}
                blurEmpty={1}
                value={form.installments}
                onChange={(_raw, n) => {
                  if (n != null) setForm((p) => ({ ...p, installments: n }));
                }}
              />
            </div>
          ) : null}
        </div>
        {!form.customer && customerQ.trim() ? (
          <div className="gv-reservation-suggest">
            {customersSearch.isLoading ? (
              <div className="muted" style={{ padding: '0.4rem 0.65rem' }}>
                Pesquisando…
              </div>
            ) : (customersSearch.data ?? []).length === 0 ? (
              <div className="muted" style={{ padding: '0.4rem 0.65rem' }}>
                Nenhum cliente para “{customerQ.trim()}”.
              </div>
            ) : (
              (customersSearch.data ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setForm((p) => ({ ...p, customer: c }));
                    setCustomerQ('');
                  }}
                >
                  <strong>{c.name}</strong>
                  <span>{[c.document, c.phone].filter(Boolean).join(' · ')}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
        {needsCustomer && !form.customer ? (
          <p className="page-desc" style={{ margin: '-0.2rem 0 0.45rem' }}>
            Crediário e requisição exigem um cliente cadastrado.
          </p>
        ) : null}

        <div className="gv-rsv-toolbar">
          <div className="field">
            <label htmlFor="rsv-product-q">Produtos ({form.lines.length})</label>
            <input
              id="rsv-product-q"
              type="search"
              placeholder="Nome, código ou barras — Enter inclui o primeiro"
              value={productQ}
              onChange={(e) => setProductQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addFirstProductHit();
                }
              }}
            />
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setProductSearchOpen(true)}>
            Pesquisar
          </button>
        </div>
        {productQ.trim() ? (
          <div className="gv-reservation-suggest">
            {productsSearch.isLoading ? (
              <div className="muted" style={{ padding: '0.4rem 0.65rem' }}>
                Pesquisando…
              </div>
            ) : (productsSearch.data ?? []).length === 0 ? (
              <div className="muted" style={{ padding: '0.4rem 0.65rem' }}>
                Nenhum produto para “{productQ.trim()}”.
              </div>
            ) : (
              (productsSearch.data ?? []).map((p) => (
                <button key={p.variantId} type="button" onClick={() => addProduct(p)}>
                  <strong>{p.productName}</strong>
                  <span>
                    {p.sku}
                    {p.barcode ? ` · ${p.barcode}` : ''} ·{' '}
                    {formatBRL(
                      (p as ProductSearchRow & { promoPrice?: string | null }).promoPrice ??
                        p.retailPrice,
                    )}{' '}
                    · estoque {formatStockQty(p.stockTotal)}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}

        <div className="gv-rsv-cart">
          {form.lines.length === 0 ? (
            <div className="gv-rsv-cart-empty">
              <strong>Nenhum produto na reserva</strong>
              <span>Pesquise acima ou use o botão Pesquisar, como no PDV.</span>
            </div>
          ) : (
            <table className="gv-rsv-cart-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th style={{ width: 132 }}>Qtd</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Total</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l) => (
                  <tr key={l.variantId}>
                    <td>
                      <div className="gv-rsv-item-name">{l.productName}</div>
                      <span className="gv-rsv-item-sku">
                        SKU {l.sku}
                        {l.barcode ? ` · EAN ${l.barcode}` : ''}
                      </span>
                    </td>
                    <td>
                      <div className="gv-rsv-qty">
                        <button
                          type="button"
                          className="gv-rsv-qty-btn"
                          aria-label={`Diminuir ${l.productName}`}
                          onClick={() => bumpQty(l.variantId, -1)}
                        >
                          −
                        </button>
                        <NumericInput
                          aria-label={`Quantidade de ${l.productName}`}
                          min={0.001}
                          blurEmpty={1}
                          value={l.quantity}
                          onChange={(_raw, n) => {
                            if (n != null) setLineQty(l.variantId, n);
                          }}
                        />
                        <button
                          type="button"
                          className="gv-rsv-qty-btn"
                          aria-label={`Aumentar ${l.productName}`}
                          onClick={() => bumpQty(l.variantId, 1)}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="gv-rsv-money">{formatBRL(l.quantity * l.unitPrice)}</div>
                      <span className="gv-rsv-unit">{formatBRL(l.unitPrice)} un</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="gv-rsv-remove"
                        aria-label={`Remover ${l.productName}`}
                        title="Remover"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            lines: prev.lines.filter((x) => x.variantId !== l.variantId),
                          }))
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="gv-reservation-totals">
          <span>
            Subtotal <strong>{formatBRL(subtotal)}</strong>
          </span>
          <span>
            Total <strong>{formatBRL(total)}</strong>
          </span>
        </div>

        <div className="field">
          <label htmlFor="rsv-notes">Observação</label>
          <input
            id="rsv-notes"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Opcional"
          />
        </div>

        <div className="gv-reservation-actions">
          {editingId ? (
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Cancelar edição
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? 'Gravando…' : editingId ? 'Salvar alterações' : 'Gravar reserva'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="page-title">
          Reservas {openRows.length ? `(${openRows.length} em aberto)` : ''}
        </h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num" style={{ width: '4rem' }}>
                  #
                </th>
                <th>Cliente</th>
                <th>Status</th>
                <th>Validade</th>
                <th className="num">Total</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Carregando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Nenhuma reserva ainda.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const open = row.status === 'OPEN';
                  return (
                    <tr key={row.id}>
                      <td className="num">{row.number}</td>
                      <td>{row.customer?.name ?? 'Cliente Balcão'}</td>
                      <td>
                        <span className={STATUS_BADGE[row.status]}>{STATUS_LABEL[row.status]}</span>
                        {row.sale ? (
                          <span className="muted"> · venda #{row.sale.number}</span>
                        ) : null}
                      </td>
                      <td>{formatDate(row.expiresAt)}</td>
                      <td className="num">{formatBRL(row.total)}</td>
                      <td className="col-actions">
                        <div className="gv-reservation-row-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            onClick={() => setViewRow(row)}
                          >
                            Visualizar
                          </button>
                          {open ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-compact"
                              onClick={() => loadReservation(row)}
                            >
                              Editar
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            onClick={() => openReservationReceipt(row.id, { copy: true })}
                          >
                            Imprimir 2ª via
                          </button>
                          {open ? (
                            <button
                              type="button"
                              className="btn btn-primary btn-compact"
                              onClick={() => {
                                setConfirmRow(row);
                                setCashId('');
                              }}
                            >
                              Confirmar venda
                            </button>
                          ) : null}
                          {open ? (
                            <button
                              type="button"
                              className="btn btn-danger btn-compact"
                              onClick={() => {
                                if (confirm(`Cancelar reserva #${row.number} e devolver o estoque?`)) {
                                  cancelMut.mutate(row.id);
                                }
                              }}
                            >
                              Cancelar
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <RecordViewModal
        open={viewRow != null}
        title={viewRow ? `Reserva #${viewRow.number}` : 'Reserva'}
        wide
        sections={viewSections}
        onClose={() => setViewRow(null)}
      />

      {confirmRow ? (
        <FormModalBackdrop
          className="modal-backdrop--cadastro no-print"
          onClose={() => setConfirmRow(null)}
        >
          <div
            className="modal form-cadastro-modal form-cadastro-modal--sm"
            role="dialog"
            aria-label="Confirmar venda"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Confirmar reserva #{confirmRow.number}</h2>
            <p className="page-desc" style={{ marginBottom: '1rem' }}>
              A venda será lançada no caixa escolhido, com os mesmos itens e formas desta reserva.
            </p>
            {openCashQ.isLoading ? (
              <p className="page-desc">Consultando caixas abertos…</p>
            ) : (openCashQ.data ?? []).length === 0 ? (
              <div className="alert alert-error">
                Não há caixa aberto no momento. Abra o caixa no PDV e tente novamente.
              </div>
            ) : (
              <div className="field">
                <label htmlFor="rsv-cash">Caixa *</label>
                <select id="rsv-cash" value={cashId} onChange={(e) => setCashId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {(openCashQ.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      Caixa #{s.controlNumber ?? '—'} · {s.user?.name ?? 'Operador'} ·{' '}
                      {formatDate(s.openedAt)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmRow(null)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!cashId || confirmMut.isPending}
                onClick={() => confirmMut.mutate()}
              >
                {confirmMut.isPending ? 'Confirmando…' : 'Confirmar venda'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      ) : null}

      <ProductSearchModal
        open={productSearchOpen}
        onClose={() => setProductSearchOpen(false)}
        onPick={addProduct}
      />
    </div>
  );
}
