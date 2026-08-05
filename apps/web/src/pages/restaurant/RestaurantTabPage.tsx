import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { isWaiter } from '../../lib/auth';
import { canPrintHere } from '../../lib/print-station';
import { calcRestaurantFees, type RestaurantFeesCompany } from '../../lib/restaurant-fees';
import { parseBarcodeWeight } from '../../lib/pos-scale';
import { usePosScale } from '../../lib/use-pos-scale';
import type { ScaleMode } from '../../lib/pos-scale';

type ProductHit = {
  variantId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  retailPrice: string | number;
  taxUnit?: string | null;
  tareKg?: string | number | null;
};

type TabItem = {
  id: string;
  quantity: string | number;
  unitPrice: string | number;
  totalLine: string | number;
  notes: string | null;
  status: string;
  weightGross?: string | number | null;
  weightTare?: string | number | null;
  kitchenPrintedAt?: string | null;
  variant: {
    id: string;
    sku: string;
    product: { id: string; name: string; taxUnit: string | null; tareKg: string | number | null };
  };
};

type Tab = {
  id: string;
  number: number;
  status: string;
  notes: string | null;
  guestCount?: number;
  customer?: { id: string; name: string } | null;
  table: { code: string; label: string | null; area: { name: string } } | null;
  items: TabItem[];
  sale?: { id: string; number: number; total: string | number } | null;
};

type CompanyScale = RestaurantFeesCompany & {
  scaleMode?: ScaleMode;
  scaleAutoConfirmMs?: number;
  barcodeWeightPattern?: string | null;
  pdvDocumentMode?: string;
  saleReceiptAutoPrint?: boolean;
  restaurantModuleEnabled?: boolean;
};

const FRACTIONAL = new Set(['KG', 'G', 'GR', 'L', 'LT', 'ML']);
const DEFAULT_CUSTOMER_NAME = 'Cliente Padrão';

function isFractional(taxUnit?: string | null) {
  return FRACTIONAL.has(String(taxUnit ?? '').trim().toUpperCase());
}

function money(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function RestaurantTabPage() {
  const { tabId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<ProductHit | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [customerNameDraft, setCustomerNameDraft] = useState('');
  const waiterOnly = isWaiter();

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () => api<CompanyScale>('/company'),
  });

  const scaleMode = (companyQ.data?.scaleMode ?? 'MANUAL') as ScaleMode;
  const scale = usePosScale({
    mode: scaleMode === 'BARCODE_LABEL' ? 'MANUAL' : scaleMode,
    autoConfirmMs: companyQ.data?.scaleAutoConfirmMs ?? 700,
    enabled: true,
  });

  const tabQ = useQuery({
    queryKey: ['restaurant', 'tab', tabId],
    queryFn: () => api<Tab>(`/restaurant/tabs/${encodeURIComponent(tabId)}`),
    enabled: Boolean(tabId),
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? false : 12_000,
    staleTime: 5_000,
  });

  const searchQ = useQuery({
    queryKey: ['products', 'search', q],
    queryFn: () => api<ProductHit[]>(`/products/search?q=${encodeURIComponent(q.trim())}`),
    enabled: q.trim().length >= 1,
  });

  const addItem = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/restaurant/tabs/${encodeURIComponent(tabId)}/items`, { method: 'POST', json: body }),
    onSuccess: () => {
      setQ('');
      setSelected(null);
      setQty('1');
      setNotes('');
      setToast('Item lançado');
      void qc.invalidateQueries({ queryKey: ['restaurant', 'tab', tabId] });
      void qc.invalidateQueries({ queryKey: ['restaurant', 'tabs'] });
    },
    onError: (e: Error) => setToast(e.message),
  });

  const cancelItem = useMutation({
    mutationFn: (itemId: string) =>
      api(`/restaurant/tabs/${encodeURIComponent(tabId)}/items/${encodeURIComponent(itemId)}/cancel`, {
        method: 'POST',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['restaurant', 'tab', tabId] }),
  });

  const kitchenPrint = useMutation({
    mutationFn: () =>
      api<{
        printedItemIds?: string[];
        dispatched?: boolean;
        stationName?: string | null;
        stationNames?: string[];
      }>(`/restaurant/tabs/${encodeURIComponent(tabId)}/kitchen-print`, {
        method: 'POST',
        json: {},
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['restaurant', 'tab', tabId] });
      const ids = res.printedItemIds ?? [];
      if (!ids.length) {
        setToast('Nenhum item novo para a cozinha.');
        return;
      }
      if (res.dispatched) {
        const names = (res.stationNames ?? []).filter(Boolean);
        const label =
          names.length > 1
            ? names.join(', ')
            : res.stationName || names[0] || 'estação';
        setToast(`Enviado para a cozinha (${label}).`);
        return;
      }
      if (!canPrintHere()) {
        setToast(
          'Nenhuma estação de impressão online. Configure em Configurações → Impressão ou use o app desktop na cozinha.',
        );
        return;
      }
      const qs = `?itens=${encodeURIComponent(ids.join(','))}&autoprint=1`;
      window.open(`/salao/comanda/${tabId}/cozinha${qs}`, '_blank', 'noopener,noreferrer');
    },
    onError: (e: Error) => setToast(e.message),
  });

  const patchTab = useMutation({
    mutationFn: (body: { guestCount?: number; customerName?: string }) =>
      api<Tab>(`/restaurant/tabs/${encodeURIComponent(tabId)}`, {
        method: 'PATCH',
        json: body,
      }),
    onSuccess: (updated) => {
      if (updated.customer?.name) setCustomerNameDraft(updated.customer.name);
      void qc.invalidateQueries({ queryKey: ['restaurant', 'tab', tabId] });
      void qc.invalidateQueries({ queryKey: ['restaurant', 'tabs'] });
      void qc.invalidateQueries({ queryKey: ['restaurant', 'areas'] });
    },
    onError: (e: Error) => setToast(e.message),
  });

  const tab = tabQ.data;

  useEffect(() => {
    if (tab?.customer?.name) {
      setCustomerNameDraft(tab.customer.name);
    } else if (tab) {
      setCustomerNameDraft(DEFAULT_CUSTOMER_NAME);
    }
  }, [tab?.id, tab?.customer?.name]);
  const activeItems = useMemo(
    () => (tab?.items ?? []).filter((i) => i.status !== 'CANCELLED'),
    [tab?.items],
  );
  const subtotal = useMemo(
    () => activeItems.reduce((s, i) => s + Number(i.totalLine), 0),
    [activeItems],
  );
  const guestCount = Math.max(1, tab?.guestCount ?? 1);
  const fees = useMemo(
    () => calcRestaurantFees(companyQ.data, subtotal, guestCount),
    [companyQ.data, subtotal, guestCount],
  );
  const total = Math.max(0, subtotal + fees.feesTotal);

  function goToPdvCheckout() {
    if (!tabId || activeItems.length === 0) {
      setToast('Inclua itens antes de cobrar no PDV.');
      return;
    }
    try {
      sessionStorage.setItem('gv_pdv_comanda', tabId);
    } catch {
      /* ignore */
    }
    navigate(`/vendas?comanda=${encodeURIComponent(tabId)}`);
  }

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  function submitAdd(e?: FormEvent) {
    e?.preventDefault();
    if (!selected) return;
    const fractional = isFractional(selected.taxUnit);
    const body: Record<string, unknown> = {
      variantId: selected.variantId,
      quantity: Number(String(qty).replace(',', '.')) || 1,
      notes: notes.trim() || null,
      printSector: 'COZINHA',
    };
    if (fractional && (scaleMode === 'SERIAL_DIRECT' || scaleMode === 'AGENT') && scale.weightKg != null) {
      body.weightGross = scale.weightKg;
      const tare = selected.tareKg != null ? Number(selected.tareKg) : 0;
      if (tare > 0) body.weightTare = tare;
    } else if (fractional) {
      body.quantity = Number(String(qty).replace(',', '.')) || 0;
    }
    addItem.mutate(body);
  }

  async function onScannerEnter() {
    const code = q.trim();
    if (!code) return;
    if (scaleMode === 'BARCODE_LABEL' || code.startsWith('2')) {
      const parsed = parseBarcodeWeight(code, companyQ.data?.barcodeWeightPattern ?? undefined);
      if (parsed) {
        const hits = await api<ProductHit[]>(
          `/products/search?q=${encodeURIComponent(parsed.plu)}`,
        );
        const hit = hits[0];
        if (hit) {
          addItem.mutate({
            variantId: hit.variantId,
            quantity: parsed.weightKg,
            weightGross: parsed.weightKg,
            printSector: 'COZINHA',
          });
          setQ('');
          return;
        }
      }
    }
    const hits = searchQ.data ?? (await api<ProductHit[]>(`/products/search?q=${encodeURIComponent(code)}`));
    if (hits[0]) {
      setSelected(hits[0]);
      if (isFractional(hits[0].taxUnit)) {
        setQty(scale.weightKg != null ? String(scale.weightKg) : '');
      } else {
        setQty('1');
        addItem.mutate({
          variantId: hits[0].variantId,
          quantity: 1,
          printSector: 'COZINHA',
        });
      }
    }
  }

  if (tabQ.isLoading) {
    return (
      <div className="page restaurant-page">
        <p>Carregando comanda…</p>
      </div>
    );
  }

  if (!tab) {
    return (
      <div className="page restaurant-page">
        <p>Comanda não encontrada.</p>
        <Link to="/salao">Voltar</Link>
      </div>
    );
  }

  const closed = tab.status !== 'OPEN';

  return (
    <div className="page restaurant-page restaurant-tab-page">
      <header className="restaurant-page__header">
        <div>
          <Link to="/salao" className="muted">
            ← Salão
          </Link>
          <h1>
            {tab.table ? (
              <>
                MESA {tab.table.label || tab.table.code}
                <span className="muted">
                  {' '}
                  · {tab.table.area.name} · Comanda #{tab.number}
                </span>
              </>
            ) : (
              <>Comanda #{tab.number}</>
            )}
            <span className="muted">
              {' '}
              · {tab.customer?.name || DEFAULT_CUSTOMER_NAME}
            </span>
          </h1>
        </div>
        <div className="restaurant-page__actions">
          <span
            className={
              'restaurant-scale-chip restaurant-scale-chip--' + (scale.status || 'idle')
            }
            title={scale.lastError ?? scale.mode}
          >
            Balança: {scale.mode === 'MANUAL' ? 'manual' : scale.status}
            {scale.weightKg != null ? ` · ${scale.weightKg.toFixed(3)} kg` : ''}
          </span>
          {(scaleMode === 'SERIAL_DIRECT') && (
            <button type="button" className="btn btn-secondary" onClick={() => void scale.connectSerial()}>
              Conectar balança
            </button>
          )}
          {!closed && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={kitchenPrint.isPending}
                onClick={() => kitchenPrint.mutate()}
              >
                Imprimir cozinha
              </button>
              {!waiterOnly ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={activeItems.length === 0}
                  onClick={goToPdvCheckout}
                  title="Envia os itens da comanda para o PDV cobrar (F2)"
                >
                  Cobrar no PDV
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>

      {toast && (
        <div className="alert alert-ok" role="status">
          {toast}
        </div>
      )}

      {!closed && (
        <section className="card" style={{ marginBottom: '0.75rem' }}>
          <div className="form-row" style={{ alignItems: 'end', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 220px', margin: 0 }}>
              <label htmlFor="tab-customer-name">Cliente</label>
              <input
                id="tab-customer-name"
                value={customerNameDraft}
                disabled={patchTab.isPending}
                placeholder={DEFAULT_CUSTOMER_NAME}
                onChange={(e) => setCustomerNameDraft(e.target.value)}
                onBlur={() => {
                  const next = customerNameDraft.trim() || DEFAULT_CUSTOMER_NAME;
                  const current = tab.customer?.name || DEFAULT_CUSTOMER_NAME;
                  if (next === current) return;
                  setCustomerNameDraft(next);
                  patchTab.mutate({ customerName: next });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </div>
            <div className="field" style={{ maxWidth: 160, margin: 0 }}>
              <label htmlFor="tab-guest-count">Pessoas</label>
              <input
                id="tab-guest-count"
                type="number"
                min={1}
                max={999}
                value={guestCount}
                disabled={patchTab.isPending}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(999, Math.floor(Number(e.target.value)) || 1));
                  patchTab.mutate({ guestCount: n });
                }}
              />
            </div>
          </div>
        </section>
      )}

      {!closed && (
        <section className="card restaurant-launch">
          <h2>Lançar item</h2>
          <form className="restaurant-launch__form" onSubmit={submitAdd}>
            <div className="field" style={{ flex: 2 }}>
              <label>Produto / código</label>
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSelected(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void onScannerEnter();
                  }
                }}
                placeholder="Busca ou bip / EAN com peso"
                autoFocus
              />
              {q.trim().length >= 1 && !selected && (searchQ.data?.length ?? 0) > 0 && (
                <ul className="restaurant-suggest">
                  {(searchQ.data ?? []).slice(0, 8).map((p) => (
                    <li key={p.variantId}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(p);
                          setQ(p.productName);
                          setQty(
                            isFractional(p.taxUnit) && scale.weightKg != null
                              ? String(scale.weightKg)
                              : isFractional(p.taxUnit)
                                ? ''
                                : '1',
                          );
                        }}
                      >
                        {p.productName}
                        <span className="muted">
                          {' '}
                          · {money(Number(p.retailPrice))}
                          {p.taxUnit ? ` / ${p.taxUnit}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="field">
              <label>Qtd / peso (kg)</label>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                placeholder={isFractional(selected?.taxUnit) ? '0,000' : '1'}
              />
              {selected && isFractional(selected.taxUnit) && scale.weightKg != null && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: '0.35rem', width: '100%' }}
                  onClick={() => setQty(String(scale.weightKg))}
                >
                  Usar peso da balança ({scale.weightKg.toFixed(3)} kg)
                </button>
              )}
            </div>
            <div className="field">
              <label>Obs.</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Sem gelo…" />
            </div>
            <div className="field" style={{ alignSelf: 'flex-end' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!selected || addItem.isPending}
              >
                Incluir
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Itens</h2>
        {activeItems.length === 0 ? (
          <p className="muted">Nenhum item.</p>
        ) : (
          <ul className="restaurant-items">
            {activeItems.map((it) => (
              <li key={it.id} className="restaurant-item-row">
                <div>
                  <strong>{it.variant.product.name}</strong>
                  <div className="muted">
                    {Number(it.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}{' '}
                    {it.variant.product.taxUnit || 'UN'} × {money(Number(it.unitPrice))}
                    {it.notes ? ` · ${it.notes}` : ''}
                    {it.kitchenPrintedAt ? ' · cozinha' : ''}
                  </div>
                </div>
                <div className="restaurant-item-row__right">
                  <strong>{money(Number(it.totalLine))}</strong>
                  {!closed && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => cancelItem.mutate(it.id)}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="restaurant-total">
          <div style={{ fontSize: '0.9rem', marginBottom: '0.35rem', opacity: 0.9 }}>
            <div>
              Itens <strong>{money(subtotal)}</strong>
            </div>
            {fees.serviceFee > 0.005 ? (
              <div>
                Taxa de serviço <strong>{money(fees.serviceFee)}</strong>
              </div>
            ) : null}
            {fees.couvert > 0.005 ? (
              <div>
                Couvert ({guestCount} {guestCount === 1 ? 'pessoa' : 'pessoas'}){' '}
                <strong>{money(fees.couvert)}</strong>
              </div>
            ) : null}
            {fees.waiterTip > 0.005 ? (
              <div>
                Taxa do garçom <strong>{money(fees.waiterTip)}</strong>
              </div>
            ) : null}
          </div>
          Total <strong>{money(total)}</strong>
          {!closed && !waiterOnly && (
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
              O pagamento é feito no PDV (caixa). Use <strong>Cobrar no PDV</strong>.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
