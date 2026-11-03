import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { formatBRL } from '../lib/format';
import './delivery.css';

type Store = {
  slug: string;
  tradeName: string;
  isOpen: boolean;
  deliveryFeeEnabled: boolean;
  deliveryFeeValue: number;
  payments: { pickup: boolean; pixDeliverer: boolean; pixOnline: boolean };
};

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  variantId: string;
  price: number;
};

type MenuCat = { id: string | null; name: string; products: MenuItem[] };

type CartLine = { variantId: string; name: string; price: number; qty: number; notes?: string };

type PublicOrder = {
  token: string;
  number: number;
  fulfillment: string;
  paymentMode: string;
  deliveryStatus: string | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
  items: Array<{ name: string; quantity: number; total: number }>;
};

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

async function publicApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const t = await res.text();
    try {
      const j = JSON.parse(t) as { message?: string | string[] };
      const msg = Array.isArray(j.message) ? j.message.join(' ') : j.message;
      throw new Error(msg || t || `Erro ${res.status}`);
    } catch (e) {
      if (e instanceof Error && e.message && !e.message.startsWith('{')) throw e;
      throw new Error(t || `Erro ${res.status}`);
    }
  }
  return res.json() as Promise<T>;
}

function cartKey(slug: string) {
  return `gv-delivery-cart:${slug}`;
}

function loadCart(slug: string): CartLine[] {
  try {
    const raw = localStorage.getItem(cartKey(slug));
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

function statusLabel(s: string | null): string {
  switch (s) {
    case 'AWAITING_PAYMENT':
      return 'Aguardando pagamento';
    case 'RECEIVED':
      return 'Pedido recebido';
    case 'PREPARING':
      return 'Em preparo';
    case 'OUT_FOR_DELIVERY':
      return 'Saiu para entrega';
    case 'READY_PICKUP':
      return 'Pronto para retirada';
    case 'COMPLETED':
      return 'Concluído';
    default:
      return s || 'Recebido';
  }
}

function DeliveryHome() {
  const { slug = '' } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [cart, setCart] = useState<CartLine[]>(() => loadCart(slug));
  const [view, setView] = useState<'menu' | 'checkout'>('menu');
  const [fulfillment, setFulfillment] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [pay, setPay] = useState<'PICKUP' | 'PIX_DELIVERER' | 'PIX_ONLINE'>('PICKUP');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(cartKey(slug), JSON.stringify(cart));
  }, [cart, slug]);

  const storeQ = useQuery({
    queryKey: ['dl-store', slug],
    queryFn: () => publicApi<Store>(`/api/public/delivery/${encodeURIComponent(slug)}`),
    enabled: Boolean(slug),
  });
  const menuQ = useQuery({
    queryKey: ['dl-menu', slug],
    queryFn: () =>
      publicApi<{ categories: MenuCat[] }>(`/api/public/delivery/${encodeURIComponent(slug)}/menu`),
    enabled: Boolean(slug),
  });

  const store = storeQ.data;
  const fee = fulfillment === 'DELIVERY' && store?.deliveryFeeEnabled ? Number(store.deliveryFeeValue) : 0;
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const total = subtotal + fee;
  const count = cart.reduce((s, l) => s + l.qty, 0);

  const availablePays = useMemo(() => {
    const p = store?.payments;
    const list: Array<{ id: 'PICKUP' | 'PIX_DELIVERER' | 'PIX_ONLINE'; label: string }> = [];
    if (p?.pickup) list.push({ id: 'PICKUP', label: 'Pagar na retirada' });
    if (p?.pixDeliverer && fulfillment === 'DELIVERY') {
      list.push({ id: 'PIX_DELIVERER', label: 'PIX ao entregador' });
    }
    if (p?.pixOnline) list.push({ id: 'PIX_ONLINE', label: 'PIX online' });
    return list;
  }, [store, fulfillment]);

  useEffect(() => {
    if (availablePays.length && !availablePays.some((p) => p.id === pay)) {
      setPay(availablePays[0].id);
    }
  }, [availablePays, pay]);

  function add(p: MenuItem) {
    setCart((cur) => {
      const i = cur.findIndex((l) => l.variantId === p.variantId);
      if (i >= 0) {
        const n = [...cur];
        n[i] = { ...n[i], qty: n[i].qty + 1 };
        return n;
      }
      return [...cur, { variantId: p.variantId, name: p.name, price: p.price, qty: 1 }];
    });
  }

  function setQty(variantId: string, qty: number) {
    setCart((cur) =>
      qty <= 0 ? cur.filter((l) => l.variantId !== variantId) : cur.map((l) => (l.variantId === variantId ? { ...l, qty } : l)),
    );
  }

  const submit = useMutation({
    mutationFn: () =>
      publicApi<PublicOrder>(`/api/public/delivery/${encodeURIComponent(slug)}/orders`, {
        method: 'POST',
        body: JSON.stringify({
          fulfillment,
          customerName: name.trim(),
          phone,
          address: fulfillment === 'DELIVERY' ? address : null,
          notes: notes.trim() || null,
          paymentMode: fulfillment === 'PICKUP' && pay === 'PIX_DELIVERER' ? 'PICKUP' : pay,
          items: cart.map((l) => ({ variantId: l.variantId, quantity: l.qty })),
        }),
      }),
    onSuccess: (order) => {
      localStorage.removeItem(cartKey(slug));
      nav(`/delivery/${slug}/p/${order.token}`);
    },
    onError: (e: Error) => setErr(e.message.replace(/[{}"]/g, ' ').slice(0, 240)),
  });

  if (storeQ.isError) {
    return (
      <div className="dl-app">
        <div className="dl-hero">
          <h1>Delivery</h1>
          <p>Estabelecimento não encontrado.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dl-app">
      <header className="dl-hero">
        <h1>{store?.tradeName ?? 'Delivery'}</h1>
        <p>Peça pelo celular · {fulfillment === 'DELIVERY' ? 'entrega' : 'retirada'}</p>
        {store && !store.isOpen ? (
          <div className="dl-closed">Fechado no momento. Confira o horário e tente mais tarde.</div>
        ) : null}
      </header>
      <div className="dl-body">
        {err ? <div className="dl-err">{err}</div> : null}
        {view === 'menu' ? (
          <>
            {(menuQ.data?.categories ?? []).map((cat) => (
              <section key={cat.id ?? cat.name}>
                <div className="dl-cat">{cat.name}</div>
                {cat.products.map((p) => {
                  const line = cart.find((l) => l.variantId === p.variantId);
                  return (
                    <article key={p.id} className="dl-item">
                      {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <div className="dl-ph" />}
                      <div style={{ flex: 1 }}>
                        <h3>{p.name}</h3>
                        {p.description ? <p className="dl-desc">{p.description}</p> : null}
                        <div className="dl-row">
                          <span className="dl-price">{formatBRL(p.price)}</span>
                          {line ? (
                            <div className="dl-qty">
                              <button type="button" onClick={() => setQty(p.variantId, line.qty - 1)}>
                                −
                              </button>
                              <strong>{line.qty}</strong>
                              <button type="button" onClick={() => setQty(p.variantId, line.qty + 1)}>
                                +
                              </button>
                            </div>
                          ) : (
                            <button type="button" className="dl-btn" onClick={() => add(p)} disabled={!store?.isOpen}>
                              Adicionar
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
            {menuQ.isSuccess && !(menuQ.data?.categories ?? []).length ? (
              <p className="dl-muted">Cardápio ainda não cadastrado.</p>
            ) : null}
          </>
        ) : (
          <>
            <div className="dl-toggle">
              <button type="button" className={fulfillment === 'DELIVERY' ? 'on' : ''} onClick={() => setFulfillment('DELIVERY')}>
                Entrega
              </button>
              <button type="button" className={fulfillment === 'PICKUP' ? 'on' : ''} onClick={() => setFulfillment('PICKUP')}>
                Retirada
              </button>
            </div>
            {cart.map((l) => (
              <div key={l.variantId} className="dl-row" style={{ marginBottom: 8 }}>
                <span>
                  {l.qty}× {l.name}
                </span>
                <strong>{formatBRL(l.price * l.qty)}</strong>
              </div>
            ))}
            {fee > 0 ? (
              <div className="dl-row" style={{ marginBottom: 8 }}>
                <span>Taxa de entrega</span>
                <strong>{formatBRL(fee)}</strong>
              </div>
            ) : null}
            <div className="dl-row" style={{ margin: '0.4rem 0 1rem' }}>
              <span>Total</span>
              <strong>{formatBRL(total)}</strong>
            </div>
            <div className="dl-field">
              <label>Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className="dl-field">
              <label>Telefone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
            </div>
            {fulfillment === 'DELIVERY' ? (
              <div className="dl-field">
                <label>Endereço</label>
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} />
              </div>
            ) : null}
            <div className="dl-field">
              <label>Observações</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="dl-field">
              <label>Pagamento</label>
              <select value={pay} onChange={(e) => setPay(e.target.value as typeof pay)}>
                {availablePays.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="dl-btn"
              style={{ width: '100%', padding: '0.85rem' }}
              disabled={submit.isPending || !store?.isOpen}
              onClick={() => {
                setErr(null);
                submit.mutate();
              }}
            >
              {submit.isPending ? 'Enviando…' : `Confirmar · ${formatBRL(total)}`}
            </button>
            <button type="button" className="dl-btn dl-btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setView('menu')}>
              Voltar ao cardápio
            </button>
          </>
        )}
      </div>
      {view === 'menu' && count > 0 ? (
        <button type="button" className="dl-bar" onClick={() => setView('checkout')}>
          <span>
            {count} item{count > 1 ? 's' : ''}
          </span>
          <strong>Ver pedido · {formatBRL(total)}</strong>
        </button>
      ) : null}
    </div>
  );
}

function DeliveryTrack() {
  const { slug = '', token = '' } = useParams<{ slug: string; token: string }>();
  const orderQ = useQuery({
    queryKey: ['dl-order', slug, token],
    queryFn: () =>
      publicApi<PublicOrder>(
        `/api/public/delivery/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}`,
      ),
    refetchInterval: 8000,
  });
  const pixQ = useQuery({
    queryKey: ['dl-pix', slug, token, orderQ.data?.paymentMode],
    queryFn: () =>
      publicApi<{ status: string; intent: { qrCode: string | null; status: string } | null }>(
        `/api/public/delivery/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}/pix`,
      ),
    enabled: orderQ.data?.paymentMode === 'PIX_ONLINE',
    refetchInterval: 4000,
  });
  const pixMut = useMutation({
    mutationFn: () =>
      publicApi<{ qrCode: string | null }>(
        `/api/public/delivery/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}/pix`,
        { method: 'POST' },
      ),
    onSuccess: () => pixQ.refetch(),
  });

  const order = orderQ.data;
  const needPix = order?.paymentMode === 'PIX_ONLINE' && order.deliveryStatus === 'AWAITING_PAYMENT';
  const qr = pixQ.data?.intent?.qrCode ?? null;

  return (
    <div className="dl-app">
      <header className="dl-hero">
        <h1>Pedido {order ? `#${order.number}` : ''}</h1>
        <p>{statusLabel(order?.deliveryStatus ?? null)}</p>
      </header>
      <div className="dl-body">
        {orderQ.isError ? <div className="dl-err">Pedido não encontrado.</div> : null}
        {order ? (
          <>
            <div className="dl-ok">{statusLabel(order.deliveryStatus)}</div>
            <p className="dl-muted" style={{ marginTop: 12 }}>
              {order.fulfillment === 'PICKUP' ? 'Retirada no local' : 'Entrega'}
            </p>
            {order.items.map((it) => (
              <div key={it.name} className="dl-row" style={{ margin: '0.4rem 0' }}>
                <span>
                  {it.quantity}× {it.name}
                </span>
                <span>{formatBRL(it.total)}</span>
              </div>
            ))}
            {order.deliveryFee > 0 ? (
              <div className="dl-row">
                <span>Taxa de entrega</span>
                <span>{formatBRL(order.deliveryFee)}</span>
              </div>
            ) : null}
            <div className="dl-row" style={{ marginTop: 8 }}>
              <strong>Total</strong>
              <strong>{formatBRL(order.total)}</strong>
            </div>
            {needPix ? (
              <div style={{ marginTop: 16 }}>
                <p>Pague com PIX para o pedido ir à cozinha.</p>
                {!qr ? (
                  <button type="button" className="dl-btn" onClick={() => pixMut.mutate()} disabled={pixMut.isPending}>
                    {pixMut.isPending ? 'Gerando…' : 'Gerar PIX'}
                  </button>
                ) : (
                  <div className="dl-pix">{qr}</div>
                )}
                {pixQ.data?.intent?.status === 'CONFIRMED' ? <p className="dl-ok">Pagamento confirmado.</p> : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="dl-muted">Carregando…</p>
        )}
      </div>
    </div>
  );
}

export function DeliveryRoot() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/delivery/:slug" element={<DeliveryHome />} />
          <Route path="/delivery/:slug/p/:token" element={<DeliveryTrack />} />
          <Route path="*" element={<p className="dl-muted" style={{ padding: 24 }}>Link inválido.</p>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
