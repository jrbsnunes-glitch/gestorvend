import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { resolveCompanyAssetUrl } from '../lib/company-branding';
import { formatDistrictMessage, isDistrictAllowed } from '../lib/delivery-districts';
import { formatBRL } from '../lib/format';
import './delivery.css';

type DistrictPolicy = {
  mode: 'OFF' | 'ALLOWLIST' | 'BLOCKLIST';
  districts: string[];
  districtsDisplay: string[];
  message: string;
};

type Store = {
  slug: string;
  tradeName: string;
  legalName?: string | null;
  logoUrl?: string | null;
  city?: string | null;
  state?: string | null;
  isOpen: boolean;
  deliveryFeeEnabled: boolean;
  deliveryFeeValue: number;
  payments: { pickup: boolean; pixDeliverer: boolean; pixOnline: boolean };
  districtPolicy?: DistrictPolicy;
};

type DeliveryAddressFields = {
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
};

type DeliveryProfile = {
  name: string;
  phone: string;
  address: DeliveryAddressFields;
  saveProfile: boolean;
  fulfillment?: 'DELIVERY' | 'PICKUP';
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
  phone?: string | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
  items: Array<{ name: string; quantity: number; total: number }>;
};

type LatestOrderResponse = {
  order: {
    token: string;
    number: number;
    deliveryStatus: string | null;
    placedAt: number;
  } | null;
};

type LastOrder = { token: string; number: number; placedAt: number };

type HomeView = 'welcome' | 'menu' | 'checkout' | 'placed';

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, refetchOnReconnect: true },
  },
});

async function publicApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const t = await res.text();
    try {
      const j = JSON.parse(t) as {
        message?: string | string[] | { message?: string; code?: string };
      };
      let msg: string | undefined;
      if (typeof j.message === 'object' && j.message && !Array.isArray(j.message)) {
        msg = j.message.message;
      } else if (Array.isArray(j.message)) {
        msg = j.message.join(' ');
      } else {
        msg = j.message;
      }
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

function lastOrderKey(slug: string) {
  return `gv-delivery-last:${slug}`;
}

function profileKey(slug: string) {
  return `gv-delivery-profile:${slug}`;
}

const EMPTY_ADDRESS: DeliveryAddressFields = {
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
};

function loadProfile(slug: string): DeliveryProfile | null {
  try {
    const raw = localStorage.getItem(profileKey(slug));
    if (!raw) return null;
    const p = JSON.parse(raw) as DeliveryProfile;
    if (!p?.name && !p?.phone) return null;
    return {
      name: p.name ?? '',
      phone: p.phone ?? '',
      saveProfile: p.saveProfile !== false,
      address: { ...EMPTY_ADDRESS, ...(p.address ?? {}) },
    };
  } catch {
    return null;
  }
}

function persistProfile(slug: string, profile: DeliveryProfile) {
  if (!profile.saveProfile) {
    localStorage.removeItem(profileKey(slug));
    return;
  }
  localStorage.setItem(profileKey(slug), JSON.stringify(profile));
}

function loadCart(slug: string): CartLine[] {
  try {
    const raw = localStorage.getItem(cartKey(slug));
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

function normalizeLastOrder(raw: unknown): LastOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { token?: string; number?: number; placedAt?: number };
  if (!o.token || !o.number) return null;
  return {
    token: o.token,
    number: o.number,
    placedAt: typeof o.placedAt === 'number' && o.placedAt > 0 ? o.placedAt : 0,
  };
}

function digitsPhone(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 32);
}

function mergeLastOrder(a: LastOrder | null, b: LastOrder | null): LastOrder | null {
  if (!a) return b;
  if (!b) return a;
  if (b.number !== a.number) return b.number > a.number ? b : a;
  if (b.placedAt !== a.placedAt) return b.placedAt > a.placedAt ? b : a;
  return b;
}

function loadLastOrder(slug: string): LastOrder | null {
  try {
    const raw = localStorage.getItem(lastOrderKey(slug));
    if (!raw) return null;
    return normalizeLastOrder(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Registra pedido recém-criado (não usar ao só visualizar acompanhamento). */
function saveLastOrder(slug: string, order: Omit<LastOrder, 'placedAt'> & { placedAt?: number }) {
  const entry: LastOrder = {
    token: order.token,
    number: order.number,
    placedAt: order.placedAt ?? Date.now(),
  };
  const merged = mergeLastOrder(loadLastOrder(slug), entry);
  if (merged) localStorage.setItem(lastOrderKey(slug), JSON.stringify(merged));
}

function applySyncedLastOrder(
  slug: string,
  remote: LatestOrderResponse['order'],
  setPlaced?: (o: LastOrder | null) => void,
) {
  if (!remote?.token || !remote.number) return;
  const entry: LastOrder = {
    token: remote.token,
    number: remote.number,
    placedAt: remote.placedAt ?? Date.now(),
  };
  const merged = mergeLastOrder(loadLastOrder(slug), entry);
  if (!merged) return;
  saveLastOrder(slug, merged);
  setPlaced?.(merged);
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

type DeliveryStatus =
  | 'AWAITING_PAYMENT'
  | 'RECEIVED'
  | 'PREPARING'
  | 'OUT_FOR_DELIVERY'
  | 'READY_PICKUP'
  | 'COMPLETED';

function statusSteps(order: Pick<PublicOrder, 'fulfillment' | 'paymentMode' | 'deliveryStatus'>) {
  const ids: DeliveryStatus[] = [
    ...(order.paymentMode === 'PIX_ONLINE' ? (['AWAITING_PAYMENT'] satisfies DeliveryStatus[]) : []),
    'RECEIVED',
    'PREPARING',
    order.fulfillment === 'PICKUP' ? 'READY_PICKUP' : 'OUT_FOR_DELIVERY',
    'COMPLETED',
  ];
  const current = (order.deliveryStatus ?? 'RECEIVED') as DeliveryStatus;
  const idx = Math.max(0, ids.indexOf(current));
  return ids.map((id, i) => ({
    id,
    label: statusLabel(id),
    state: i < idx ? 'done' : i === idx ? 'current' : 'todo',
  }));
}

/** Polla só com a aba visível; celular não precisa puxar a tela. */
function useLiveRefetchMs(ms: number, stop: boolean) {
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
    };
  }, []);
  if (stop || hidden) return false;
  return ms;
}

function IconMenu() {
  return (
    <svg viewBox="0 0 64 64" width="42" height="42" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 16h36v4H14zm0 14h36v4H14zm0 14h24v4H14z"
      />
    </svg>
  );
}

function IconBag() {
  return (
    <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20 20v-2a12 12 0 0 1 24 0v2h8v32a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V20zm4 0h16v-2a8 8 0 0 0-16 0z"
      />
    </svg>
  );
}

function IconPin() {
  return (
    <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M32 8a16 16 0 0 1 16 16c0 12-16 32-16 32S16 36 16 24A16 16 0 0 1 32 8zm0 10a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"
      />
    </svg>
  );
}

function DeliveryHome() {
  const { slug = '' } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const initialProfile = loadProfile(slug);
  const [cart, setCart] = useState<CartLine[]>(() => loadCart(slug));
  const [view, setView] = useState<HomeView>('welcome');
  const [fulfillment, setFulfillment] = useState<'DELIVERY' | 'PICKUP'>(() =>
    initialProfile?.fulfillment === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
  );
  const [name, setName] = useState(initialProfile?.name ?? '');
  const [phone, setPhone] = useState(initialProfile?.phone ?? '');
  const [addr, setAddr] = useState<DeliveryAddressFields>(() => ({
    ...EMPTY_ADDRESS,
    ...(initialProfile?.address ?? {}),
  }));
  const [saveProfile, setSaveProfile] = useState(initialProfile?.saveProfile !== false);
  const [districtTouched, setDistrictTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [pay, setPay] = useState<'PICKUP' | 'PIX_DELIVERER' | 'PIX_ONLINE'>('PICKUP');
  const [err, setErr] = useState<string | null>(null);
  const [placed, setPlaced] = useState<LastOrder | null>(() => loadLastOrder(slug));

  useEffect(() => {
    setPlaced(loadLastOrder(slug));
  }, [slug]);

  const syncPhone = digitsPhone(phone || loadProfile(slug)?.phone || '');

  const latestOrderQ = useQuery({
    queryKey: ['dl-latest-order', slug, syncPhone],
    queryFn: () =>
      publicApi<LatestOrderResponse>(
        `/api/public/delivery/${encodeURIComponent(slug)}/orders/latest?phone=${encodeURIComponent(syncPhone)}`,
      ),
    enabled: Boolean(slug) && syncPhone.length >= 8,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (latestOrderQ.data?.order) {
      applySyncedLastOrder(slug, latestOrderQ.data.order, setPlaced);
    }
  }, [latestOrderQ.data, slug]);

  useEffect(() => {
    if (view !== 'welcome') return;
    const syncLocal = () => setPlaced(loadLastOrder(slug));
    syncLocal();
    document.addEventListener('visibilitychange', syncLocal);
    return () => document.removeEventListener('visibilitychange', syncLocal);
  }, [view, slug]);

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
    enabled: Boolean(slug) && (view === 'menu' || view === 'checkout'),
  });

  const store = storeQ.data;
  const fee = fulfillment === 'DELIVERY' && store?.deliveryFeeEnabled ? Number(store.deliveryFeeValue) : 0;
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const total = subtotal + fee;
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const logoSrc = store?.logoUrl?.trim() ? resolveCompanyAssetUrl(store.logoUrl) : null;
  const storeName = store?.tradeName || store?.legalName || 'Delivery';
  const districtPolicy = store?.districtPolicy;
  const storeCity = store?.city?.trim() || '';

  useEffect(() => {
    if (storeCity && !addr.city.trim()) {
      setAddr((a) => ({ ...a, city: storeCity }));
    }
  }, [storeCity, addr.city]);

  const districtBlocked = useMemo(() => {
    if (fulfillment !== 'DELIVERY' || !districtPolicy || districtPolicy.mode === 'OFF') return false;
    if (!districtTouched && !addr.district.trim()) return false;
    return !isDistrictAllowed(districtPolicy.mode, districtPolicy.districts, addr.district);
  }, [fulfillment, districtPolicy, districtTouched, addr.district]);

  const districtWarnText = useMemo(() => {
    if (!districtBlocked || !districtPolicy) return '';
    return formatDistrictMessage(
      districtPolicy.message,
      addr.district.trim() || 'seu bairro',
      addr.city.trim() || storeCity || 'sua cidade',
    );
  }, [districtBlocked, districtPolicy, addr.district, addr.city, storeCity]);

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
          address: null,
          addressFields:
            fulfillment === 'DELIVERY'
              ? {
                  street: addr.street.trim(),
                  number: addr.number.trim(),
                  complement: addr.complement.trim() || null,
                  district: addr.district.trim(),
                  city: addr.city.trim() || storeCity || null,
                }
              : null,
          saveCustomerData: saveProfile,
          notes: notes.trim() || null,
          paymentMode: fulfillment === 'PICKUP' && pay === 'PIX_DELIVERER' ? 'PICKUP' : pay,
          items: cart.map((l) => ({ variantId: l.variantId, quantity: l.qty })),
        }),
      }),
    onSuccess: (order) => {
      localStorage.removeItem(cartKey(slug));
      setCart([]);
      persistProfile(slug, {
        name: name.trim(),
        phone,
        address: addr,
        saveProfile,
        fulfillment,
      });
      const last: LastOrder = {
        token: order.token,
        number: order.number,
        placedAt: Date.now(),
      };
      saveLastOrder(slug, last);
      setPlaced(last);
      setView('placed');
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

  if (view === 'welcome') {
    return (
      <div className="dl-app dl-app--welcome">
        <div className="dl-welcome">
          <div className="dl-welcome__brand">
            {logoSrc ? (
              <img className="dl-welcome__logo" src={logoSrc} alt={storeName} />
            ) : (
              <div className="dl-welcome__logo dl-welcome__logo--ph" aria-hidden="true">
                <IconBag />
              </div>
            )}
            <p className="dl-welcome__hello">Bem-vindo</p>
            <h1>{storeName}</h1>
            <p className="dl-welcome__sub">Peça pelo celular · entrega ou retirada</p>
            {store && !store.isOpen ? (
              <div className="dl-closed">Fechado no momento. Confira o horário e tente mais tarde.</div>
            ) : null}
          </div>
          <button
            type="button"
            className="dl-welcome__enter"
            onClick={() => {
              setErr(null);
              setView('menu');
            }}
          >
            <span className="dl-welcome__icon" aria-hidden="true">
              <IconMenu />
            </span>
            <strong>Ver cardápio</strong>
            <span>Toque para montar o pedido</span>
          </button>
          {placed ? (
            <button
              type="button"
              className="dl-btn dl-btn-ghost dl-welcome__track"
              onClick={() => nav(`/delivery/${slug}/p/${placed.token}`)}
            >
              Acompanhar pedido #{placed.number}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (view === 'placed' && placed) {
    return (
      <div className="dl-app">
        <header className="dl-hero">
          <h1>Pedido #{placed.number}</h1>
          <p>Recebemos o seu pedido</p>
        </header>
        <div className="dl-body">
          <div className="dl-ok">Pedido enviado. Acompanhe o status ou volte ao início.</div>
          <button
            type="button"
            className="dl-btn"
            style={{ width: '100%', padding: '0.9rem', marginTop: 16 }}
            onClick={() => nav(`/delivery/${slug}/p/${placed.token}`)}
          >
            Acompanhar pedido
          </button>
          <button
            type="button"
            className="dl-btn dl-btn-ghost"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => setView('welcome')}
          >
            Voltar ao menu inicial
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dl-app">
      <header className="dl-hero">
        <button type="button" className="dl-back" onClick={() => setView(view === 'checkout' ? 'menu' : 'welcome')}>
          ← {view === 'checkout' ? 'Cardápio' : 'Início'}
        </button>
        <h1>{storeName}</h1>
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
              <details key={cat.id ?? cat.name} className="dl-cat-block">
                <summary className="dl-cat-summary">
                  <span>{cat.name}</span>
                  <span className="dl-cat-summary__meta">{cat.products.length} itens</span>
                </summary>
                <div className="dl-cat-body">
                {cat.products.map((p) => {
                  const line = cart.find((l) => l.variantId === p.variantId);
                  return (
                    <article key={p.id} className="dl-item">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <div className="dl-ph" />
                      )}
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
                </div>
              </details>
            ))}
            {menuQ.isSuccess && !(menuQ.data?.categories ?? []).length ? (
              <p className="dl-muted">Cardápio ainda não cadastrado.</p>
            ) : null}
          </>
        ) : (
          <>
            <div className="dl-toggle">
              <button
                type="button"
                className={fulfillment === 'DELIVERY' ? 'on' : ''}
                onClick={() => {
                  setFulfillment('DELIVERY');
                  setDistrictTouched(false);
                }}
              >
                Entrega
              </button>
              <button
                type="button"
                className={fulfillment === 'PICKUP' ? 'on' : ''}
                onClick={() => {
                  setFulfillment('PICKUP');
                  setDistrictTouched(false);
                  setErr(null);
                }}
              >
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
              <>
                <div className="dl-field">
                  <label>Rua / avenida</label>
                  <input
                    value={addr.street}
                    onChange={(e) => setAddr((a) => ({ ...a, street: e.target.value }))}
                    autoComplete="street-address"
                  />
                </div>
                <div className="dl-field dl-field--row">
                  <div>
                    <label>Número</label>
                    <input
                      value={addr.number}
                      onChange={(e) => setAddr((a) => ({ ...a, number: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label>Complemento</label>
                    <input
                      value={addr.complement}
                      onChange={(e) => setAddr((a) => ({ ...a, complement: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="dl-field">
                  <label>Bairro</label>
                  <input
                    value={addr.district}
                    onChange={(e) => setAddr((a) => ({ ...a, district: e.target.value }))}
                    onBlur={() => setDistrictTouched(true)}
                    autoComplete="address-level3"
                  />
                </div>
                <div className="dl-field">
                  <label>Cidade</label>
                  <input
                    value={addr.city}
                    onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))}
                    autoComplete="address-level2"
                  />
                </div>
                {districtBlocked ? (
                  <div className="dl-area-warn" role="alert">
                    <p>{districtWarnText}</p>
                    <div className="dl-area-warn__actions">
                      <button
                        type="button"
                        className="dl-btn"
                        onClick={() => {
                          setFulfillment('PICKUP');
                          setDistrictTouched(false);
                          setErr(null);
                        }}
                      >
                        Retirar no restaurante
                      </button>
                      <button
                        type="button"
                        className="dl-btn dl-btn--ghost"
                        onClick={() => {
                          setDistrictTouched(false);
                          setAddr((a) => ({ ...a, district: '' }));
                        }}
                      >
                        Alterar bairro
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="dl-field">
              <label className="dl-check">
                <input
                  type="checkbox"
                  checked={saveProfile}
                  onChange={(e) => setSaveProfile(e.target.checked)}
                />
                <span>
                  Lembrar meus dados neste celular
                  <small>Salvar também no cadastro do restaurante</small>
                </span>
              </label>
            </div>
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
              className="dl-btn dl-btn--ghost"
              style={{ width: '100%', padding: '0.75rem', marginBottom: '0.5rem' }}
              onClick={() => setView('menu')}
            >
              Adicionar mais itens
            </button>
            <button
              type="button"
              className="dl-btn"
              style={{ width: '100%', padding: '0.85rem' }}
              disabled={
                submit.isPending ||
                !store?.isOpen ||
                (fulfillment === 'DELIVERY' && districtBlocked)
              }
              onClick={() => {
                setErr(null);
                if (fulfillment === 'DELIVERY') setDistrictTouched(true);
                submit.mutate();
              }}
            >
              {submit.isPending ? 'Enviando…' : `Confirmar · ${formatBRL(total)}`}
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
  const nav = useNavigate();
  const liveMs = useLiveRefetchMs(4000, false);

  const orderQ = useQuery({
    queryKey: ['dl-order', slug, token],
    queryFn: () =>
      publicApi<PublicOrder>(
        `/api/public/delivery/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}`,
      ),
    refetchInterval: (q) => {
      if (q.state.data?.deliveryStatus === 'COMPLETED') return false;
      return liveMs;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === 'visible') void orderQ.refetch();
    };
    document.addEventListener('visibilitychange', bump);
    window.addEventListener('focus', bump);
    window.addEventListener('online', bump);
    return () => {
      document.removeEventListener('visibilitychange', bump);
      window.removeEventListener('focus', bump);
      window.removeEventListener('online', bump);
    };
  }, [orderQ.refetch]);

  const pixQ = useQuery({
    queryKey: ['dl-pix', slug, token, orderQ.data?.paymentMode],
    queryFn: () =>
      publicApi<{ status: string; intent: { qrCode: string | null; status: string } | null }>(
        `/api/public/delivery/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}/pix`,
      ),
    enabled: orderQ.data?.paymentMode === 'PIX_ONLINE',
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? false : 3000,
    refetchOnWindowFocus: true,
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
  const trackPhone = digitsPhone(order?.phone ?? loadProfile(slug)?.phone ?? '');

  const latestOrderQ = useQuery({
    queryKey: ['dl-latest-order', slug, trackPhone],
    queryFn: () =>
      publicApi<LatestOrderResponse>(
        `/api/public/delivery/${encodeURIComponent(slug)}/orders/latest?phone=${encodeURIComponent(trackPhone)}`,
      ),
    enabled: Boolean(slug) && trackPhone.length >= 8,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (latestOrderQ.data?.order) {
      applySyncedLastOrder(slug, latestOrderQ.data.order);
    }
  }, [latestOrderQ.data, slug]);

  const newerOrder =
    latestOrderQ.data?.order && order && latestOrderQ.data.order.number > order.number
      ? latestOrderQ.data.order
      : null;

  const needPix = order?.paymentMode === 'PIX_ONLINE' && order.deliveryStatus === 'AWAITING_PAYMENT';
  const qr = pixQ.data?.intent?.qrCode ?? null;
  const done = order?.deliveryStatus === 'COMPLETED';
  const steps = order ? statusSteps(order) : [];

  return (
    <div className="dl-app">
      <header className="dl-hero">
        <h1>Pedido {order ? `#${order.number}` : ''}</h1>
        <p>{order ? statusLabel(order.deliveryStatus) : orderQ.isError ? 'Não encontrado' : 'Carregando…'}</p>
        {order && !done ? (
          <div className="dl-live" aria-live="polite">
            <span className="dl-live__dot" />
            Atualiza sozinho
          </div>
        ) : null}
      </header>
      <div className="dl-body">
        {orderQ.isError ? (
          <>
            <div className="dl-err">Pedido não encontrado.</div>
            <button
              type="button"
              className="dl-btn dl-btn-ghost"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => nav(`/delivery/${slug}`)}
            >
              Voltar ao menu inicial
            </button>
          </>
        ) : null}
        {order ? (
          <>
            {newerOrder ? (
              <div className="dl-area-warn" role="status">
                <p>
                  Seu pedido mais recente é o <strong>#{newerOrder.number}</strong>
                  {newerOrder.deliveryStatus === 'COMPLETED' ? ' (já concluído)' : ''}.
                </p>
                <button
                  type="button"
                  className="dl-btn"
                  style={{ width: '100%' }}
                  onClick={() => nav(`/delivery/${slug}/p/${newerOrder.token}`)}
                >
                  Ver pedido #{newerOrder.number}
                </button>
              </div>
            ) : null}
            <ol className="dl-steps">
              {steps.map((st) => (
                <li key={st.id} className={`dl-steps__item dl-steps__item--${st.state}`}>
                  <span className="dl-steps__mark" />
                  <span>{st.label}</span>
                </li>
              ))}
            </ol>
            <p className="dl-muted dl-track-kind">
              <IconPin /> {order.fulfillment === 'PICKUP' ? 'Retirada no local' : 'Entrega'}
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
            <button
              type="button"
              className="dl-btn"
              style={{ width: '100%', padding: '0.85rem', marginTop: 20 }}
              onClick={() => nav(`/delivery/${slug}`)}
            >
              Voltar ao menu inicial
            </button>
          </>
        ) : orderQ.isError ? null : (
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
