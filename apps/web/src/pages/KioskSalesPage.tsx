import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PixQrPaymentModal } from '../components/payments/PixQrPaymentModal';
import type { PaymentIntent } from '../lib/payments';
import { formatBRL } from '../lib/format';
import { api } from '../lib/api';
import { getDesktopApi, isGestorVendDesktop } from '../lib/desktop-bridge';
import {
  apiKiosk,
  clearKioskAuth,
  getKioskMeta,
  getKioskToken,
  loginKioskTerminal,
  type KioskMeta,
} from '../lib/kiosk-auth';
import './kiosk-sales.css';

type KioskProduct = {
  variantId: string;
  sku: string;
  barcode: string | null;
  name: string;
  controlNumber: number;
  retailPrice: string;
  imageThumbUrl: string | null;
};

type CartItem = {
  variantId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  imageThumbUrl: string | null;
};

type KioskBootstrap = {
  terminal: {
    number: number;
    name: string;
    allowedMethods: string[];
  };
  cashSessionId: string | null;
  payments: {
    mercadoPagoEnabled: boolean;
    hasOnlinePix: boolean;
    hasPointIntegration: boolean;
    mercadoPagoPublicKey: string | null;
    activeProvider: string | null;
    visibleProviders: string[];
  };
};

type KioskScreen = 'pair' | 'catalog' | 'cart' | 'payment';

function KioskPairing({
  defaultTenant,
  defaultTerminal,
  onPaired,
}: {
  defaultTenant: string;
  defaultTerminal: number | null;
  onPaired: (meta: KioskMeta) => void;
}) {
  const [tenantSlug, setTenantSlug] = useState(defaultTenant);
  const [terminalNumber, setTerminalNumber] = useState(
    defaultTerminal != null ? String(defaultTerminal) : '',
  );
  const [token, setToken] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const pair = useMutation({
    mutationFn: () =>
      loginKioskTerminal({
        tenantSlug: tenantSlug.trim().toLowerCase(),
        terminalNumber: Math.floor(Number(terminalNumber)),
        token: token.trim(),
      }),
    onSuccess: onPaired,
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="kiosk-pair">
      <div className="kiosk-pair__card">
        <h1>Pareamento do PDV</h1>
        <p>Informe os dados do terminal para iniciar o autoatendimento.</p>
        {err ? <div className="kiosk-alert kiosk-alert--error">{err}</div> : null}
        <label>
          Empresa (slug)
          <input value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Número do PDV
          <input
            type="number"
            min={1}
            value={terminalNumber}
            onChange={(e) => setTerminalNumber(e.target.value)}
          />
        </label>
        <label>
          Token do terminal
          <textarea
            rows={3}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="uuid.segredo"
          />
        </label>
        <button
          type="button"
          className="kiosk-btn kiosk-btn--primary"
          disabled={pair.isPending || !tenantSlug.trim() || !terminalNumber || !token.trim()}
          onClick={() => pair.mutate()}
        >
          {pair.isPending ? 'Conectando…' : 'Conectar'}
        </button>
      </div>
    </div>
  );
}

export function KioskSalesPage() {
  const [sp] = useSearchParams();
  const terminalFromUrl = sp.get('terminal');
  const parsedTerminal = terminalFromUrl ? Math.floor(Number(terminalFromUrl)) : null;

  const [meta, setMeta] = useState<KioskMeta | null>(() => {
    const stored = getKioskMeta();
    if (!stored) return null;
    if (parsedTerminal != null && stored.terminalNumber !== parsedTerminal) return null;
    return stored;
  });
  const [screen, setScreen] = useState<KioskScreen>(() =>
    getKioskToken() && meta ? 'catalog' : 'pair',
  );
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pixModal, setPixModal] = useState(false);
  const [cardMode, setCardMode] = useState<'CREDIT' | 'DEBIT' | null>(null);
  const [cardWaiting, setCardWaiting] = useState(false);
  const [cardSeconds, setCardSeconds] = useState(120);
  const [pointIntentId, setPointIntentId] = useState<string | null>(null);
  const [pointError, setPointError] = useState<string | null>(null);
  const pointConfirmedRef = useRef(false);
  const [finishMsg, setFinishMsg] = useState<string | null>(null);
  const [defaultTenant, setDefaultTenant] = useState('');

  const isKioskShell = isGestorVendDesktop() && Boolean(getDesktopApi()?.isKiosk);

  useEffect(() => {
    void getDesktopApi()?.getConfig?.().then(async (cfg) => {
      if (cfg?.tenantSlug) setDefaultTenant(cfg.tenantSlug);
      const term = cfg?.pdvTerminal;
      if (term?.token && term.number && !getKioskToken()) {
        try {
          const m = await loginKioskTerminal({
            tenantSlug: cfg!.tenantSlug,
            terminalNumber: term.number,
            token: term.token,
          });
          setMeta(m);
          setScreen('catalog');
        } catch {
          /* pareamento manual */
        }
      }
    });
  }, []);

  const bootstrapQ = useQuery({
    queryKey: ['kiosk', 'bootstrap', meta?.terminalId],
    queryFn: () => apiKiosk<KioskBootstrap>('/kiosk/bootstrap'),
    enabled: Boolean(getKioskToken() && meta),
    refetchInterval: 60_000,
  });

  const productsQ = useQuery({
    queryKey: ['kiosk', 'products', search],
    queryFn: () =>
      apiKiosk<KioskProduct[]>(`/kiosk/products/search?q=${encodeURIComponent(search.trim())}`),
    enabled: Boolean(getKioskToken() && meta && search.trim().length >= 1),
  });

  const total = useMemo(
    () => cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
    [cart],
  );

  const allowed = useMemo(
    () => new Set(bootstrapQ.data?.terminal.allowedMethods ?? ['PIX', 'CARD_CREDIT', 'CARD_DEBIT']),
    [bootstrapQ.data],
  );

  const hasPointIntegration = Boolean(bootstrapQ.data?.payments.hasPointIntegration);

  const completeSale = useMutation({
    mutationFn: (payments: Array<{
      method: 'PIX' | 'CARD';
      amount: number;
      paymentFormName?: string;
      paymentIntentId?: string | null;
      authCode?: string | null;
    }>) =>
      apiKiosk<{ id: string; number: number }>('/kiosk/sales', {
        method: 'POST',
        json: {
          cashSessionId: bootstrapQ.data?.cashSessionId ?? null,
          items: cart.map((c) => ({
            variantId: c.variantId,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
          })),
          payments,
        },
      }),
    onSuccess: async (sale) => {
      setFinishMsg(`Venda #${sale.number} concluída!`);
      setCart([]);
      setScreen('catalog');
      setCardMode(null);
      setCardWaiting(false);
      setPointIntentId(null);
      setPointError(null);
      pointConfirmedRef.current = false;

      if (isKioskShell) {
        const kioskToken = getKioskToken();
        const desktopApi = getDesktopApi();
        const pdv = await desktopApi?.getPdvPrinter?.();
        const qs = new URLSearchParams({ id: sale.id, autoprint: '1' });
        if (kioskToken) qs.set('kioskToken', kioskToken);
        void desktopApi?.printUrl?.({
          url: `/vendas/impressao?${qs.toString()}`,
          deviceName: pdv?.printer ?? undefined,
          pageSize: '80mm',
        });
      }

      window.setTimeout(() => setFinishMsg(null), 5000);
    },
  });

  const pointCharge = useMutation({
    mutationFn: (body: { paymentType: 'credit_card' | 'debit_card' }) =>
      apiKiosk<PaymentIntent>('/kiosk/payments/point', {
        method: 'POST',
        json: { amount: total, ...body },
      }),
    onSuccess: (intent) => {
      setPointIntentId(intent.id);
      setPointError(null);
    },
    onError: (e: Error) => {
      setPointError(e.message);
      setCardWaiting(false);
      setCardMode(null);
    },
  });

  const pointStatusQ = useQuery({
    queryKey: ['kiosk', 'point-intent', pointIntentId],
    queryFn: () => api<PaymentIntent>(`/payments/intents/${pointIntentId}?refresh=1`),
    enabled: Boolean(hasPointIntegration && cardWaiting && pointIntentId),
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      if (st === 'CONFIRMED' || st === 'FAILED' || st === 'CANCELLED' || st === 'EXPIRED') {
        return false;
      }
      return 2500;
    },
  });

  useEffect(() => {
    if (!hasPointIntegration || !pointIntentId || pointConfirmedRef.current) return;
    const st = pointStatusQ.data?.status;
    if (st !== 'CONFIRMED') return;
    pointConfirmedRef.current = true;
    const intent = pointStatusQ.data!;
    const label =
      cardMode === 'DEBIT' ? 'Débito maquininha (Point)' : 'Crédito maquininha (Point)';
    completeSale.mutate([
      {
        method: 'CARD',
        amount: total,
        paymentIntentId: intent.id,
        authCode: intent.authCode ?? intent.externalId ?? null,
        paymentFormName: label,
      },
    ]);
  }, [hasPointIntegration, pointIntentId, pointStatusQ.data, cardMode, total, completeSale]);

  useEffect(() => {
    if (!hasPointIntegration || !pointIntentId) return;
    const st = pointStatusQ.data?.status;
    if (st === 'FAILED' || st === 'CANCELLED' || st === 'EXPIRED') {
      setPointError('Pagamento não concluído. Tente novamente.');
      setCardWaiting(false);
      setCardMode(null);
      setPointIntentId(null);
      void api(`/payments/intents/${pointIntentId}`, { method: 'DELETE' }).catch(() => undefined);
    }
  }, [hasPointIntegration, pointIntentId, pointStatusQ.data?.status]);

  const addToCart = useCallback((p: KioskProduct) => {
    const price = Number(p.retailPrice);
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.variantId === p.variantId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx]!, quantity: next[idx]!.quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          variantId: p.variantId,
          name: p.name,
          unitPrice: price,
          quantity: 1,
          imageThumbUrl: p.imageThumbUrl,
        },
      ];
    });
  }, []);

  useEffect(() => {
    if (!cardWaiting || cardSeconds <= 0) return;
    const t = window.setInterval(() => setCardSeconds((s) => s - 1), 1000);
    return () => window.clearInterval(t);
  }, [cardWaiting, cardSeconds]);

  useEffect(() => {
    if (cardWaiting && cardSeconds <= 0) {
      if (hasPointIntegration && pointIntentId) {
        void api(`/payments/intents/${pointIntentId}`, { method: 'DELETE' }).catch(() => undefined);
        setPointIntentId(null);
      }
      setCardWaiting(false);
      setCardMode(null);
      setPointError(hasPointIntegration ? 'Tempo esgotado. Tente novamente.' : null);
      pointConfirmedRef.current = false;
    }
  }, [cardWaiting, cardSeconds, hasPointIntegration, pointIntentId]);

  function onPaired(m: KioskMeta) {
    setMeta(m);
    setScreen('catalog');
  }

  function adjustQty(variantId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) =>
          c.variantId === variantId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c,
        )
        .filter((c) => c.quantity > 0),
    );
  }

  function startCardPayment(mode: 'CREDIT' | 'DEBIT') {
    setCardMode(mode);
    setCardWaiting(true);
    setCardSeconds(120);
    setPointError(null);
    pointConfirmedRef.current = false;
    setPointIntentId(null);
    if (hasPointIntegration) {
      pointCharge.mutate({
        paymentType: mode === 'DEBIT' ? 'debit_card' : 'credit_card',
      });
    }
  }

  function cancelCardPayment() {
    if (hasPointIntegration && pointIntentId) {
      void api(`/payments/intents/${pointIntentId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    setPointIntentId(null);
    setPointError(null);
    pointConfirmedRef.current = false;
    setCardMode(null);
    setCardWaiting(false);
  }

  function confirmCardPayment() {
    if (!cardMode || total <= 0) return;
    const label = cardMode === 'DEBIT' ? 'Débito maquininha' : 'Crédito maquininha';
    completeSale.mutate([
      { method: 'CARD', amount: total, paymentFormName: label },
    ]);
  }

  function onPixConfirmed(intent: PaymentIntent) {
    setPixModal(false);
    completeSale.mutate([
      {
        method: 'PIX',
        amount: total,
        paymentIntentId: intent.id,
        authCode: intent.authCode ?? intent.externalId ?? null,
        paymentFormName: 'PIX Mercado Pago',
      },
    ]);
  }

  if (screen === 'pair' || !meta || !getKioskToken()) {
    return (
      <KioskPairing
        defaultTenant={defaultTenant}
        defaultTerminal={parsedTerminal}
        onPaired={onPaired}
      />
    );
  }

  const terminalLabel = bootstrapQ.data?.terminal.name ?? meta.terminalName;
  const terminalNum = bootstrapQ.data?.terminal.number ?? meta.terminalNumber;
  const mpVisible = bootstrapQ.data?.payments.visibleProviders?.includes('MERCADO_PAGO');

  return (
    <div className={'kiosk-shell' + (isKioskShell ? ' kiosk-shell--electron' : '')}>
      <header className="kiosk-header">
        <div>
          <span className="kiosk-header__eyebrow">Autoatendimento</span>
          <h1>
            PDV {terminalNum} · {terminalLabel}
          </h1>
        </div>
        <div className="kiosk-header__actions">
          {cart.length > 0 ? (
            <button type="button" className="kiosk-btn" onClick={() => setScreen('cart')}>
              Carrinho ({cart.length}) · {formatBRL(total)}
            </button>
          ) : null}
          {!isKioskShell ? (
            <button
              type="button"
              className="kiosk-btn kiosk-btn--ghost"
              onClick={() => {
                clearKioskAuth();
                setMeta(null);
                setScreen('pair');
              }}
            >
              Sair
            </button>
          ) : null}
        </div>
      </header>

      {finishMsg ? <div className="kiosk-toast">{finishMsg}</div> : null}

      {screen === 'catalog' && (
        <div className="kiosk-catalog">
          <div className="kiosk-search">
            <input
              type="search"
              placeholder="Buscar produto (nome, código, EAN)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="kiosk-grid">
            {(productsQ.data ?? []).map((p) => (
              <button
                key={p.variantId}
                type="button"
                className="kiosk-product"
                onClick={() => addToCart(p)}
              >
                {p.imageThumbUrl ? (
                  <img src={p.imageThumbUrl} alt="" loading="lazy" className="kiosk-product__img" />
                ) : (
                  <div className="kiosk-product__placeholder" aria-hidden />
                )}
                <span className="kiosk-product__name">{p.name}</span>
                <span className="kiosk-product__price">{formatBRL(Number(p.retailPrice))}</span>
              </button>
            ))}
          </div>
          {search.trim() && productsQ.isFetching ? <p className="kiosk-hint">Buscando…</p> : null}
          {search.trim() && !productsQ.isFetching && (productsQ.data?.length ?? 0) === 0 ? (
            <p className="kiosk-hint">Nenhum produto encontrado.</p>
          ) : null}
          {cart.length > 0 ? (
            <footer className="kiosk-footer">
              <button
                type="button"
                className="kiosk-btn kiosk-btn--primary kiosk-btn--lg"
                onClick={() => setScreen('cart')}
              >
                Ver carrinho · {formatBRL(total)}
              </button>
            </footer>
          ) : null}
        </div>
      )}

      {screen === 'cart' && (
        <div className="kiosk-cart">
          <h2>Seu pedido</h2>
          <ul className="kiosk-cart__list">
            {cart.map((c) => (
              <li key={c.variantId} className="kiosk-cart__item">
                {c.imageThumbUrl ? (
                  <img src={c.imageThumbUrl} alt="" className="kiosk-cart__thumb" />
                ) : (
                  <div className="kiosk-cart__thumb kiosk-cart__thumb--empty" />
                )}
                <div className="kiosk-cart__info">
                  <strong>{c.name}</strong>
                  <span>{formatBRL(c.unitPrice)}</span>
                </div>
                <div className="kiosk-cart__qty">
                  <button type="button" onClick={() => adjustQty(c.variantId, -1)}>
                    −
                  </button>
                  <span>{c.quantity}</span>
                  <button type="button" onClick={() => adjustQty(c.variantId, 1)}>
                    +
                  </button>
                </div>
                <strong>{formatBRL(c.unitPrice * c.quantity)}</strong>
              </li>
            ))}
          </ul>
          <div className="kiosk-cart__total">
            <span>Total</span>
            <strong>{formatBRL(total)}</strong>
          </div>
          <div className="kiosk-cart__actions">
            <button type="button" className="kiosk-btn" onClick={() => setScreen('catalog')}>
              Continuar comprando
            </button>
            <button
              type="button"
              className="kiosk-btn kiosk-btn--primary kiosk-btn--lg"
              disabled={total <= 0}
              onClick={() => setScreen('payment')}
            >
              Pagar
            </button>
          </div>
        </div>
      )}

      {screen === 'payment' && (
        <div className="kiosk-payment">
          <h2>Pagamento</h2>
          <p className="kiosk-payment__total">{formatBRL(total)}</p>
          {completeSale.isError ? (
            <div className="kiosk-alert kiosk-alert--error">{completeSale.error.message}</div>
          ) : null}

          {!cardMode ? (
            <div className="kiosk-payment__methods">
              {allowed.has('PIX') && bootstrapQ.data?.payments.hasOnlinePix && mpVisible ? (
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn--primary kiosk-btn--lg"
                  onClick={() => setPixModal(true)}
                  disabled={completeSale.isPending}
                >
                  PIX (QR Code)
                </button>
              ) : null}
              {allowed.has('CARD_CREDIT') ? (
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn--lg"
                  onClick={() => startCardPayment('CREDIT')}
                  disabled={completeSale.isPending}
                >
                  Cartão crédito
                </button>
              ) : null}
              {allowed.has('CARD_DEBIT') ? (
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn--lg"
                  onClick={() => startCardPayment('DEBIT')}
                  disabled={completeSale.isPending}
                >
                  Cartão débito
                </button>
              ) : null}
            </div>
          ) : (
            <div className="kiosk-card-wait">
              <p>
                {hasPointIntegration ? (
                  <>
                    Aproxime ou insira o cartão na <strong>maquininha</strong> no valor de{' '}
                    <strong>{formatBRL(total)}</strong>.
                  </>
                ) : (
                  <>
                    Passe ou insira o cartão na <strong>maquininha</strong> no valor de{' '}
                    <strong>{formatBRL(total)}</strong>.
                  </>
                )}
              </p>
              <p className="kiosk-hint">
                {cardMode === 'DEBIT' ? 'Débito' : 'Crédito'}
                {hasPointIntegration ? ' · aguardando confirmação automática' : ''} ({cardSeconds}s)
              </p>
              {pointError ? <div className="kiosk-alert kiosk-alert--error">{pointError}</div> : null}
              {hasPointIntegration && (pointCharge.isPending || pointStatusQ.isFetching) ? (
                <p className="kiosk-hint">Processando pagamento…</p>
              ) : null}
              {!hasPointIntegration ? (
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn--primary kiosk-btn--lg"
                  onClick={confirmCardPayment}
                  disabled={completeSale.isPending}
                >
                  Pagamento concluído na maquininha
                </button>
              ) : null}
              <button
                type="button"
                className="kiosk-btn kiosk-btn--ghost"
                onClick={cancelCardPayment}
                disabled={completeSale.isPending || pointCharge.isPending}
              >
                Voltar
              </button>
            </div>
          )}

          <button type="button" className="kiosk-btn kiosk-btn--ghost" onClick={() => setScreen('cart')}>
            ← Voltar ao carrinho
          </button>
        </div>
      )}

      <PixQrPaymentModal
        open={pixModal}
        amount={total}
        provider="MERCADO_PAGO"
        onClose={() => setPixModal(false)}
        onConfirmed={onPixConfirmed}
      />
    </div>
  );
}
