import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isManager, profileLabel, type UserProfile } from '../lib/auth';
import { formatBRL, formatDate } from '../lib/format';
import {
  effectiveAutoPrintAfterSale,
  getPosAutoPrintMode,
  posAutoPrintModeLabel,
  queueSaleReceiptAutoPrint,
  setPosAutoPrintMode,
  type PosAutoPrintMode,
} from '../lib/sale-receipt-print';
import './pos.css';

/* ----------------------------------------------------------------------------
 * Tipos de domínio
 * ------------------------------------------------------------------------- */

type SaleItemRowApi = {
  id: string;
  variantId: string;
  quantity: string;
  totalLine: string;
  variant: { sku: string; product: { name: string } };
};

/** Venda como retornada por GET /sales (inclui itens quando expandido pelo backend). */
type SaleSummary = {
  id: string;
  number: number;
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  total: string;
  createdAt: string;
  customer: { name: string } | null;
  items?: SaleItemRowApi[];
};

/** Limites do dia no fuso local (para contagem "vendas hoje" no PDV). */
function startOfLocalDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(23, 59, 59, 999);
  return x;
}

type ProductSearchRow = {
  productId: string;
  productName: string;
  description: string | null;
  variantId: string;
  sku: string;
  barcode: string | null;
  retailPrice: string;
  promoPrice: string | null;
  costAverage: string;
  stockTotal: string;
  minStock: string;
};

type Customer = { id: string; name: string };

type CashSession = {
  id: string;
  openingBalance: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
};

/** Identidade do operador logado — usada no header do PDV/gateway. */
type Operator = {
  id: string;
  name: string;
  email: string;
  profile: UserProfile;
};

/** Resumo de um caixa aberto exibido na lista do gerente. */
type OpenSessionSummary = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openingBalance: string;
  openedAt: string;
  userId: string;
  user: { id: string; name: string; email: string } | null;
  movementsIn: number;
  movementsOut: number;
};

type CartLine = {
  variantId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  unitPrice: number;
  quantity: number;
  stockTotal: number;
  minStock: number;
};

type PaymentKind = 'CASH' | 'CARD' | 'PIX' | 'CREDIT' | 'OTHER';

/** Inclui `EXPENSE` só no fechamento (não é forma de pagamento de venda). */
type CloseMethodKey = PaymentKind | 'EXPENSE';

type CartPayment = {
  id: string;
  method: PaymentKind;
  amount: number;
  installments: number;
};

/* ----------------------------------------------------------------------------
 * Constantes / utilitários
 * ------------------------------------------------------------------------- */

const PAY_METHODS: Array<{ key: PaymentKind; label: string; icon: string }> = [
  { key: 'CASH', label: 'Dinheiro', icon: '💵' },
  { key: 'CARD', label: 'Cartão', icon: '💳' },
  { key: 'PIX', label: 'Pix', icon: '⚡' },
  { key: 'CREDIT', label: 'Crediário', icon: '🧾' },
  { key: 'OTHER', label: 'Outro', icon: '➕' },
];

const CLOSE_ROWS: Array<{ key: CloseMethodKey; label: string; icon: string }> = [
  ...PAY_METHODS,
  { key: 'EXPENSE', label: 'Despesas', icon: '📤' },
];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function parseDecimal(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function classifyStock(stock: number, qtyInCart: number, minStock: number) {
  const remaining = stock - qtyInCart;
  if (remaining <= 0) return 'out';
  if (remaining < minStock) return 'low';
  return 'ok';
}

/* ----------------------------------------------------------------------------
 * Página principal — decide entre Gateway de Caixa e PDV
 * ------------------------------------------------------------------------- */

export function SalesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  /**
   * Sessão de caixa atual do usuário. O backend só retorna sessões
   * `OPEN` (filtro em `cash.controller.ts`), portanto `data` será o caixa
   * aberto ou `null`. Defensivamente, o front também valida `status === 'OPEN'`
   * para nunca tratar uma sessão fechada como ativa.
   *
   * `refetchOnMount: 'always'` garante que ao voltar ao gateway (após fechar
   * caixa, por exemplo) os dados sejam sempre buscados frescos do servidor.
   */
  const sessionQ = useQuery({
    queryKey: ['cash', 'session'],
    queryFn: () => api<CashSession | null>('/cash/session'),
    refetchOnMount: 'always',
  });

  /** Identidade do operador — usada para exibir nome/perfil no PDV. */
  const operatorQ = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api<Operator>('/users/me'),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Gerente: lista de todos os caixas abertos no tenant, para que ele possa
  // ver/escolher entre os caixas dos operadores antes de entrar no PDV.
  const managerView = isManager();
  const openSessionsQ = useQuery({
    queryKey: ['cash', 'sessions', 'OPEN'],
    queryFn: () => api<OpenSessionSummary[]>('/cash/sessions?status=OPEN'),
    enabled: managerView,
    refetchOnMount: 'always',
  });

  /**
   * Controla se o operador já passou pelo gateway nesta visita.
   * Mesmo que exista um caixa aberto, ao entrar em /vendas o usuário começa
   * pela tela de escolha (continuar/abrir) — confirma deliberadamente antes
   * de operar. Ao sair do PDV o componente desmonta e este estado é
   * resetado, garantindo a tela de escolha na próxima entrada.
   */
  const [entered, setEntered] = useState(false);

  /** Mensagem para mostrar no gateway (ex.: confirmação de fechamento). */
  const [gatewayNotice, setGatewayNotice] = useState<string | null>(null);

  function exitToDashboard() {
    navigate('/');
  }

  function enterPdv() {
    setEntered(true);
    setGatewayNotice(null);
  }

  // Sessão ativa = existe no cache E está com status OPEN (sanity check).
  const activeSession =
    sessionQ.data && sessionQ.data.status === 'OPEN' ? sessionQ.data : null;

  const operator = operatorQ.data ?? null;

  if (sessionQ.isLoading) {
    return <PosGatewayLoading operator={operator} onExit={exitToDashboard} />;
  }

  // Sem caixa aberto OU usuário ainda não confirmou -> Gateway
  if (!entered || !activeSession) {
    return (
      <PosGateway
        session={activeSession}
        operator={operator}
        isFetching={sessionQ.isFetching}
        notice={gatewayNotice}
        isManagerView={managerView}
        openSessions={openSessionsQ.data ?? []}
        currentUserId={operator?.id ?? null}
        onDismissNotice={() => setGatewayNotice(null)}
        onExit={exitToDashboard}
        onEnter={enterPdv}
        onSelectOtherSession={() => navigate('/caixa')}
        onAfterOpen={(newSession) => {
          /*
           * Refresh instantâneo: já populamos o cache da query
           * ['cash','session'] com o objeto retornado pelo POST /cash/open.
           * Assim, quando o PDV monta, ele renderiza imediatamente a sessão
           * recém-aberta — sem o flicker do "Verificando caixa…" que ocorria
           * enquanto o refetch da query terminava.
           */
          qc.setQueryData(['cash', 'session'], newSession);
          qc.invalidateQueries({ queryKey: ['cash', 'session', newSession?.id ? newSession.id : ''] });
          setGatewayNotice(null);
          setEntered(true);
        }}
      />
    );
  }

  return (
    <PosScreen
      session={activeSession}
      operator={operator}
      onExit={exitToDashboard}
      onCashClosed={() => {
        /*
         * Importante: usamos `setQueryData` para zerar o cache *imediatamente*
         * (síncrono). Se apenas chamássemos `invalidateQueries`, o próximo
         * render do gateway ainda mostraria a sessão antiga (ainda `OPEN`)
         * até o refetch concluir, deixando o botão "Abrir novo caixa"
         * desabilitado e permitindo que o usuário "reentrasse" num caixa
         * que já foi fechado.
         */
        qc.setQueryData(['cash', 'session'], null);
        qc.invalidateQueries({ queryKey: ['cash', 'session'] });
        setEntered(false);
        setGatewayNotice('Caixa fechado com sucesso. Você pode abrir um novo agora.');
      }}
    />
  );
}

/* ----------------------------------------------------------------------------
 * Gateway de caixa — abrir novo OU continuar com caixa aberto
 * ------------------------------------------------------------------------- */

function PosGatewayLoading({
  operator,
  onExit,
}: {
  operator: Operator | null;
  onExit: () => void;
}) {
  return (
    <div className="pos-gateway">
      <PosGatewayHeader operator={operator} onExit={onExit} />
      <div className="pos-gateway-main">
        <div className="pos-gateway-loading">Verificando caixa…</div>
      </div>
    </div>
  );
}

function PosGatewayHeader({
  operator,
  onExit,
}: {
  operator: Operator | null;
  onExit: () => void;
}) {
  return (
    <div className="pos-gateway-header">
        <div className="pos-gateway-brand">
          <img
            className="pos-gateway-brand-mark"
            src="/gestor-venda-logo.png"
            alt="Gestor Vendas"
            decoding="async"
          />
          <div className="pos-gateway-brand-aside">
            <span className="pos-gateway-brand-tag">Frente de caixa</span>
          </div>
        </div>
      <div className="pos-gateway-header-right">
        {operator && (
          <div className="pos-gateway-operator" aria-label="Operador logado">
            <span
              className="pos-gateway-operator-avatar"
              aria-hidden
              title={operator.name}
            >
              {operator.name.trim().slice(0, 1).toUpperCase()}
            </span>
            <div className="pos-gateway-operator-info">
              <strong>{operator.name}</strong>
              <span>
                {profileLabel(operator.profile)} · {operator.email}
              </span>
            </div>
          </div>
        )}
        <button type="button" className="pos-gateway-exit" onClick={onExit}>
          ← Sair para o sistema
        </button>
      </div>
    </div>
  );
}

function PosGateway({
  session,
  operator,
  isFetching,
  notice,
  isManagerView,
  openSessions,
  currentUserId,
  onDismissNotice,
  onExit,
  onEnter,
  onSelectOtherSession,
  onAfterOpen,
}: {
  session: CashSession | null;
  operator: Operator | null;
  isFetching: boolean;
  notice: string | null;
  isManagerView: boolean;
  openSessions: OpenSessionSummary[];
  currentUserId: string | null;
  onDismissNotice: () => void;
  onExit: () => void;
  onEnter: () => void;
  onSelectOtherSession: () => void;
  onAfterOpen: (session: CashSession) => void;
}) {
  const [opening, setOpening] = useState('0,00');
  const [err, setErr] = useState<string | null>(null);

  const openMut = useMutation({
    mutationFn: () =>
      api<CashSession>('/cash/open', {
        method: 'POST',
        json: { openingBalance: parseDecimal(opening) },
      }),
    onSuccess: (session) => {
      setErr(null);
      // Propaga o objeto recém-criado: o pai (SalesPage) popula o cache
      // do `GET /cash/session` instantaneamente — sem aguardar o refetch.
      onAfterOpen(session);
    },
    onError: (e: Error) => setErr(e.message),
  });

  // Só considera "tem caixa aberto" se o status real ainda for OPEN.
  // Isso evita brechas quando o cache fica desatualizado por um instante.
  const hasOpen = !!session && session.status === 'OPEN';

  return (
    <div className="pos-gateway">
      <PosGatewayHeader operator={operator} onExit={onExit} />
      <div className="pos-gateway-main">
        <div className="pos-gateway-content">
          <h1 className="pos-gateway-title">
            Olá{operator ? `, ${operator.name.split(' ')[0]}` : ''}
          </h1>
          <p className="pos-gateway-subtitle">
            Para começar a registrar vendas, abra um novo caixa ou continue o
            atendimento em um caixa já aberto.
          </p>

          {notice && (
            <div
              className="pos-gateway-notice"
              role="status"
              onClick={onDismissNotice}
              title="Clique para dispensar"
            >
              ✓ {notice}
            </div>
          )}

          <div className="pos-gateway-grid">
            {/* ----- Continuar com caixa aberto ----- */}
            <article
              className="pos-gateway-card"
              data-disabled={hasOpen ? 'false' : 'true'}
            >
              <div className="pos-gateway-card-icon is-continue" aria-hidden>
                ▶
              </div>
              <h3>Continuar com caixa aberto</h3>
              <p className="pos-gateway-card-desc">
                Retomar o atendimento no caixa que ficou aberto do último uso.
              </p>

              {session ? (
                // Importante: o backend de /cash/session retorna apenas o
                // caixa do `user.sub` do JWT, então um caixa aqui sempre
                // pertence ao operador logado. Não exibimos "Operador"
                // novamente para evitar confusão — ele já aparece no header
                // e no card "Abrir novo caixa".
                <dl className="pos-gateway-card-info">
                  <dt>Aberto em</dt>
                  <dd>{formatDate(session.openedAt)}</dd>
                  <dt>Saldo inicial</dt>
                  <dd>{formatBRL(session.openingBalance)}</dd>
                </dl>
              ) : (
                <dl className="pos-gateway-card-info">
                  <dt>Status</dt>
                  <dd>Você não possui caixa em aberto</dd>
                </dl>
              )}

              <div className="pos-gateway-card-cta">
                <button
                  type="button"
                  className="pos-gateway-btn pos-gateway-btn-primary"
                  disabled={!hasOpen || isFetching}
                  onClick={onEnter}
                  title={
                    isFetching
                      ? 'Atualizando status do caixa…'
                      : hasOpen
                        ? 'Entrar no PDV'
                        : 'Não há caixa aberto'
                  }
                >
                  {isFetching && !hasOpen ? 'Verificando…' : 'Entrar no PDV'}
                </button>
              </div>
            </article>

            {/* ----- Abrir novo caixa ----- */}
            <article
              className="pos-gateway-card"
              data-disabled={hasOpen ? 'true' : 'false'}
            >
              <div className="pos-gateway-card-icon is-open" aria-hidden>
                +
              </div>
              <h3>Abrir novo caixa</h3>
              <p className="pos-gateway-card-desc">
                Iniciar uma nova sessão informando o saldo de troco (fundo de caixa).
              </p>

              {operator && (
                <dl className="pos-gateway-card-info">
                  <dt>Operador</dt>
                  <dd>{operator.name}</dd>
                  <dt>Perfil</dt>
                  <dd>{profileLabel(operator.profile)}</dd>
                </dl>
              )}

              <div className="pos-gateway-card-input">
                <label htmlFor="opening">Saldo inicial (R$)</label>
                <input
                  id="opening"
                  inputMode="decimal"
                  value={opening}
                  disabled={hasOpen}
                  onChange={(e) => setOpening(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !hasOpen) openMut.mutate();
                  }}
                  placeholder="0,00"
                />
              </div>

              <div className="pos-gateway-card-cta">
                <button
                  type="button"
                  className="pos-gateway-btn pos-gateway-btn-secondary"
                  disabled={hasOpen || openMut.isPending}
                  onClick={() => openMut.mutate()}
                >
                  {openMut.isPending ? 'Abrindo…' : 'Abrir caixa'}
                </button>
              </div>
            </article>
          </div>

          {hasOpen && (
            <p
              style={{
                marginTop: '1.5rem',
                textAlign: 'center',
                fontSize: '0.85rem',
                color: 'rgba(255,255,255,0.65)',
              }}
            >
              Já existe um caixa aberto para este operador. Feche-o antes de abrir
              um novo (use o botão <strong>Fechar caixa</strong> dentro do PDV).
            </p>
          )}

          {/* === Bloco exclusivo do gerente: outros caixas abertos === */}
          {isManagerView && (
            <ManagerOpenSessions
              sessions={openSessions}
              currentUserId={currentUserId}
              onSelect={onSelectOtherSession}
            />
          )}

          {err && <div className="pos-gateway-error">{err}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Lista compacta dos caixas abertos por outros operadores — apenas visível
 * para perfis gerentes. Permite que o gerente acompanhe quem está com caixa
 * em aberto e navegue para o menu Caixa caso queira detalhar / fechar / ver
 * vendas.
 */
function ManagerOpenSessions({
  sessions,
  currentUserId,
  onSelect,
}: {
  sessions: OpenSessionSummary[];
  currentUserId: string | null;
  onSelect: () => void;
}) {
  const others = sessions.filter((s) => s.userId !== currentUserId);

  return (
    <section className="pos-gateway-manager">
      <header>
        <h3>Caixas abertos no momento</h3>
        <span>
          {sessions.length}{' '}
          {sessions.length === 1 ? 'caixa aberto' : 'caixas abertos'}
        </span>
      </header>
      {sessions.length === 0 ? (
        <p className="pos-gateway-manager-empty">
          Nenhum caixa aberto no momento.
        </p>
      ) : (
        <ul>
          {sessions.map((s) => {
            const mine = s.userId === currentUserId;
            return (
              <li key={s.id} className={mine ? 'is-mine' : ''}>
                <div className="pos-gateway-manager-avatar" aria-hidden>
                  {s.user?.name?.trim().slice(0, 1).toUpperCase() ?? '?'}
                </div>
                <div className="pos-gateway-manager-info">
                  <strong>
                    {s.user?.name ?? '—'}
                    {mine && <span className="pos-gateway-manager-tag">você</span>}
                  </strong>
                  <span>
                    Aberto em {new Date(s.openedAt).toLocaleString('pt-BR')} · fundo{' '}
                    {formatBRL(s.openingBalance)}
                  </span>
                </div>
                <span className="pos-gateway-manager-balance">
                  +{formatBRL(s.movementsIn)} / −{formatBRL(s.movementsOut)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 && (
        <button type="button" className="pos-gateway-manager-cta" onClick={onSelect}>
          Ver detalhes no menu Caixa →
        </button>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------
 * Tela do PDV (full-screen) com o caixa já aberto
 * ------------------------------------------------------------------------- */

function PosScreen({
  session,
  operator,
  onExit,
  onCashClosed,
}: {
  session: CashSession;
  operator: Operator | null;
  onExit: () => void;
  onCashClosed: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  /* --- estado do carrinho atual --- */
  const [lines, setLines] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [payments, setPayments] = useState<CartPayment[]>([]);

  /* --- estado da UI --- */
  const [scannerValue, setScannerValue] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closingByMethod, setClosingByMethod] = useState<Record<CloseMethodKey, string>>({
    CASH: '',
    CARD: '',
    PIX: '',
    CREDIT: '',
    OTHER: '',
    EXPENSE: '',
  });
  const [closingNotes, setClosingNotes] = useState('');
  const [closeErr, setCloseErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /**
   * Overlay full-screen do pagamento (acionado por F2). Quando aberta, o
   * teclado entra em modo "tap to pay": 1=Dinheiro, 2=Cartão, 3=Pix,
   * 4=Crediário, 5=Outro, Enter=Confirmar, Esc=Voltar.
   */
  const [paymentMenuOpen, setPaymentMenuOpen] = useState(false);
  /** Após concluir venda: atalho para cupom não fiscal (bobina térmica). */
  const [receiptPrompt, setReceiptPrompt] = useState<{ id: string; number: number } | null>(null);

  const [printPrefsOpen, setPrintPrefsOpen] = useState(false);

  const scannerRef = useRef<HTMLInputElement>(null);

  /** Devoluções / ajustes de vendas já concluídas (API: admin/manager). */
  const [saleLineRemoveDraft, setSaleLineRemoveDraft] = useState<{
    sale: SaleSummary;
    selectedItemId: string;
  } | null>(null);
  const canManagePastSales = isManager();

  /* --- queries --- */

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () =>
      api<{
        saleReceiptAutoPrint?: boolean;
        saleReceiptPrinterHint?: string | null;
      }>('/company'),
    staleTime: 60_000,
  });

  const sales = useQuery({
    queryKey: ['sales'],
    queryFn: () => api<SaleSummary[]>('/sales'),
  });

  const salesTodayQ = useQuery({
    queryKey: ['sales', 'today'],
    queryFn: () => {
      const now = new Date();
      const from = startOfLocalDay(now).toISOString();
      const to = endOfLocalDay(now).toISOString();
      return api<SaleSummary[]>(`/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    },
    refetchInterval: 60_000,
  });

  const customers = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Customer[]>('/customers'),
    enabled: customerOpen,
  });

  const search = useQuery({
    queryKey: ['products', 'search', scannerValue],
    queryFn: () => api<ProductSearchRow[]>(`/products/search?q=${encodeURIComponent(scannerValue.trim())}`),
    enabled: suggestOpen && scannerValue.trim().length >= 1,
    staleTime: 2_000,
  });

  /**
   * Detalhe da sessão (incluindo o `summary.byMethod` com o esperado para o
   * fechamento). Carregado sob demanda: só fetcha quando o modal de fechar
   * caixa abre, evitando trabalho desnecessário.
   */
  const closeDetailQ = useQuery({
    queryKey: ['cash', 'sessions', session.id, 'detail'],
    queryFn: () =>
      api<{
        summary: { byMethod: Record<string, number>; totalCompleted: number };
      }>(`/cash/sessions/${session.id}`),
    enabled: closeOpen,
  });

  /* --- foco automático no scanner --- */

  useEffect(() => {
    scannerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2400);
      return () => clearTimeout(t);
    }
  }, [toast]);

  /* --- totais derivados --- */

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    [lines],
  );
  const total = Math.max(0, subtotal - discount);
  const paidSum = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments]);
  const remaining = Math.max(0, total - paidSum);
  const change = Math.max(0, paidSum - total);
  const canFinish = lines.length > 0 && total > 0 && paidSum + 0.02 >= total;

  const receiptAutoSummary = useMemo(() => {
    const m = getPosAutoPrintMode();
    const c = companyQ.data?.saleReceiptAutoPrint ?? false;
    if (m === 'on') return 'Cupom: auto (esta máquina)';
    if (m === 'off') return 'Cupom: manual (esta máquina)';
    return c ? 'Cupom: auto (empresa)' : 'Cupom: manual (empresa)';
  }, [companyQ.data?.saleReceiptAutoPrint]);

  /* --- mutações --- */

  const createSale = useMutation({
    mutationFn: () =>
      api<{ id: string; number: number }>('/sales', {
        method: 'POST',
        json: {
          customerId: customer?.id ?? null,
          discount,
          items: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
          payments: payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            installments: p.method === 'CREDIT' ? p.installments : 1,
          })),
        },
      }),
    onSuccess: (sale) => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['reports', 'sales-summary'] });
      const concluded = total;
      resetSale();
      setPaymentMenuOpen(false);
      const auto = effectiveAutoPrintAfterSale(companyQ.data?.saleReceiptAutoPrint ?? false);
      if (auto) {
        queueSaleReceiptAutoPrint(sale.id);
        setReceiptPrompt(null);
      } else {
        setReceiptPrompt({ id: sale.id, number: sale.number });
      }
      setToast({ kind: 'ok', text: `Venda #${sale.number} concluída ${formatBRL(concluded)}` });
      scannerRef.current?.focus();
    },
    onError: (e: Error) => setToast({ kind: 'err', text: e.message }),
  });

  const cancelSale = useMutation({
    mutationFn: (id: string) => api(`/sales/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['reports', 'sales-summary'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      setToast({ kind: 'ok', text: 'Venda cancelada. Estoque estornado.' });
    },
    onError: (e: Error) => setToast({ kind: 'err', text: e.message }),
  });

  const removeSaleLineMut = useMutation({
    mutationFn: ({ saleId, itemId }: { saleId: string; itemId: string }) =>
      api(`/sales/${saleId}/items/${encodeURIComponent(itemId)}/remove`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales', 'today'] });
      qc.invalidateQueries({ queryKey: ['reports', 'sales-summary'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      setSaleLineRemoveDraft(null);
      setToast({ kind: 'ok', text: 'Item removido da venda. Totais e pagamentos foram recalculados.' });
    },
    onError: (e: Error) => setToast({ kind: 'err', text: e.message }),
  });

  // Soma de todos os valores contados por método -> total declarado.
  const closingTotal = useMemo(
    () =>
      (Object.values(closingByMethod) as string[]).reduce(
        (s, v) => s + parseDecimal(v),
        0,
      ),
    [closingByMethod],
  );

  const closeCash = useMutation({
    mutationFn: () => {
      // Mantém o JSON enviado limpo: ignora chaves com valor zero/vazio para
      // não poluir a auditoria com entradas sem significado.
      const payload: Record<string, number> = {};
      for (const [k, v] of Object.entries(closingByMethod)) {
        const num = parseDecimal(v);
        if (num > 0) payload[k] = num;
      }
      return api('/cash/close', {
        method: 'POST',
        json: {
          closingBalance: closingTotal,
          closingByMethod: payload,
          closingNotes: closingNotes.trim() || null,
        },
      });
    },
    onSuccess: () => {
      setCloseOpen(false);
      setCloseErr(null);
      onCashClosed();
      setToast({ kind: 'ok', text: 'Caixa fechado com sucesso.' });
    },
    onError: (e: Error) => setCloseErr(e.message),
  });

  /* --- ações do carrinho --- */

  const addLineFromProduct = useCallback((p: ProductSearchRow) => {
    const promo = p.promoPrice ? parseDecimal(p.promoPrice) : 0;
    const retail = parseDecimal(p.retailPrice);
    const unitPrice = promo > 0 && promo < retail ? promo : retail;

    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === p.variantId);
      if (idx >= 0) {
        return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          variantId: p.variantId,
          productName: p.productName,
          sku: p.sku,
          barcode: p.barcode,
          unitPrice,
          quantity: 1,
          stockTotal: parseDecimal(p.stockTotal),
          minStock: parseDecimal(p.minStock),
        },
      ];
    });
    setScannerValue('');
    setSuggestOpen(false);
    setSuggestIdx(0);
  }, []);

  function updateLineQty(variantId: string, qty: number) {
    if (qty <= 0) {
      setLines((prev) => prev.filter((l) => l.variantId !== variantId));
      return;
    }
    setLines((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, quantity: qty } : l)),
    );
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  function resetSale() {
    setLines([]);
    setDiscount(0);
    setCustomer(null);
    setPayments([]);
    setScannerValue('');
    setSuggestOpen(false);
  }

  /* --- pagamento apenas na overlay F2 --- */

  /* --- scanner --- */

  function handleScannerKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = scannerValue.trim();
      if (!val) return;
      if (suggestOpen && search.data && search.data.length > 0) {
        const item = search.data[suggestIdx] ?? search.data[0];
        if (item) addLineFromProduct(item);
        return;
      }
      void resolveByCode(val);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestOpen(true);
      setSuggestIdx((i) => Math.min((search.data?.length ?? 1) - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Escape') {
      setSuggestOpen(false);
      setSuggestIdx(0);
    }
  }

  async function resolveByCode(code: string) {
    try {
      const matches = await qc.fetchQuery({
        queryKey: ['products', 'search', code],
        queryFn: () => api<ProductSearchRow[]>(`/products/search?q=${encodeURIComponent(code)}`),
        staleTime: 2_000,
      });
      const exact =
        matches.find((m) => m.barcode === code || m.sku === code) ?? matches[0];
      if (exact) {
        addLineFromProduct(exact);
      } else {
        setToast({ kind: 'err', text: `Nenhum produto para "${code}"` });
        setSuggestOpen(true);
      }
    } catch (e) {
      setToast({ kind: 'err', text: (e as Error).message });
    }
  }

  /* --- atalhos globais --- */

  useEffect(() => {
    function onKey(ev: globalThis.KeyboardEvent) {
      // Quando o submenu de pagamento estiver aberto, ele captura o teclado
      // sozinho — aqui apenas evitamos disparar outros atalhos.
      if (customerOpen || historyOpen || closeOpen || paymentMenuOpen) return;
      if (ev.key === 'F2') {
        ev.preventDefault();
        if (lines.length > 0 && total > 0) {
          // F2 agora abre o submenu de pagamento (fluxo de caixa real:
          // 1º bipa produtos, 2º aperta F2, 3º escolhe forma de pagamento).
          setPayments([]);
          setPaymentMenuOpen(true);
        }
      } else if (ev.key === 'F4') {
        ev.preventDefault();
        setCustomerOpen(true);
      } else if (ev.key === 'F8') {
        ev.preventDefault();
        const v = prompt('Desconto em R$ no total da venda', String(discount));
        if (v != null) setDiscount(Math.max(0, parseDecimal(v)));
      } else if (ev.key === 'Escape' && lines.length > 0) {
        if (confirm('Cancelar venda atual e limpar carrinho?')) resetSale();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    canFinish,
    createSale,
    customerOpen,
    discount,
    historyOpen,
    closeOpen,
    lines.length,
    total,
    paymentMenuOpen,
  ]);

  function tryExit() {
    if (lines.length > 0) {
      if (!confirm('Há uma venda em andamento. Sair mesmo assim? O carrinho será descartado.')) {
        return;
      }
    }
    onExit();
  }

  /* --- render --- */

  return (
    <div className="pos-fullscreen">
      <PosTopbar
        session={session}
        operator={operator}
        salesToday={salesTodayQ.data?.filter((s) => s.status === 'COMPLETED').length ?? 0}
        receiptAutoSummary={receiptAutoSummary}
        onOpenPrintPrefs={() => setPrintPrefsOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onExit={tryExit}
        onCloseCash={() => {
          setCloseOpen(true);
          setClosingByMethod({ CASH: '', CARD: '', PIX: '', CREDIT: '', OTHER: '', EXPENSE: '' });
          setClosingNotes('');
          setCloseErr(null);
        }}
      />

      {receiptPrompt && (
        <div className="pos-receipt-prompt no-print" role="status">
          <span>
            Venda <strong>#{receiptPrompt.number}</strong> — cupom não fiscal pronto para impressão.
          </span>
          <div className="pos-receipt-prompt-actions">
            <button
              type="button"
              className="pos-btn pos-btn-ghost"
              onClick={() => {
                navigate(`/vendas/impressao?id=${encodeURIComponent(receiptPrompt.id)}`);
              }}
            >
              Imprimir cupom
            </button>
            <button type="button" className="pos-btn pos-btn-ghost" onClick={() => setReceiptPrompt(null)}>
              Ocultar
            </button>
          </div>
        </div>
      )}

      <div className="pos-fullscreen-body">
        <div className="pos-shell">
          {/* ---------- COLUNA ESQUERDA ---------- */}
          <div className="pos-left">
            <div className="pos-scanner" onClick={() => scannerRef.current?.focus()}>
              <span className="pos-scanner-icon" aria-hidden>
                🔍
              </span>
              <input
                ref={scannerRef}
                className="pos-scanner-input"
                autoFocus
                placeholder="Bipar código de barras ou pesquisar por SKU/nome…"
                value={scannerValue}
                onChange={(e) => {
                  setScannerValue(e.target.value);
                  setSuggestOpen(e.target.value.trim().length >= 1);
                  setSuggestIdx(0);
                }}
                onKeyDown={handleScannerKeyDown}
                onFocus={() => {
                  if (scannerValue.trim().length >= 1) setSuggestOpen(true);
                }}
              />
              <span className="pos-scanner-hint">Enter = adicionar · ↓ = pesquisa</span>

              {suggestOpen && scannerValue.trim().length >= 1 && (
                <div className="pos-suggest" role="listbox">
                  {search.isLoading && <div className="pos-suggest-empty">Pesquisando…</div>}
                  {!search.isLoading && (!search.data || search.data.length === 0) && (
                    <div className="pos-suggest-empty">Nenhum produto para “{scannerValue}”.</div>
                  )}
                  {search.data?.slice(0, 30).map((p, i) => {
                    const stock = parseDecimal(p.stockTotal);
                    const min = parseDecimal(p.minStock);
                    const pillClass = stock <= 0 ? 'out' : stock < min ? 'low' : 'ok';
                    return (
                      <div
                        key={p.variantId}
                        role="option"
                        aria-selected={i === suggestIdx}
                        className="pos-suggest-item"
                        onMouseEnter={() => setSuggestIdx(i)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addLineFromProduct(p);
                        }}
                      >
                        <div>
                          <div className="pos-suggest-name">{p.productName}</div>
                          <div className="pos-suggest-meta">
                            SKU {p.sku}
                            {p.barcode ? ` · EAN ${p.barcode}` : ''}
                          </div>
                        </div>
                        <div>
                          <div className="pos-suggest-price">{formatBRL(p.retailPrice)}</div>
                          <div className={`pos-suggest-stock pos-stock-pill ${pillClass}`}>
                            {stock <= 0 ? 'Sem estoque' : `Em estoque: ${stock}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pos-card" style={{ flex: 1 }}>
              <div className="pos-card-header">
                <h3 className="pos-card-title">
                  Itens da venda{' '}
                  <span style={{ color: 'var(--pos-text-muted)' }}>({lines.length})</span>
                </h3>
                {lines.length > 0 && (
                  <button
                    type="button"
                    className="pos-btn pos-btn-ghost"
                    onClick={() => {
                      if (confirm('Limpar todos os itens?')) setLines([]);
                    }}
                    style={{ minHeight: 32, padding: '0.35rem 0.7rem', fontSize: '0.82rem' }}
                  >
                    Limpar
                  </button>
                )}
              </div>
              <div className="pos-card-body pos-cart-body-split" style={{ padding: 0 }}>
                <div className="pos-items-scroll-area">
                  <div className="pos-items">
                  {lines.length === 0 ? (
                    <div className="pos-items-empty">
                      <div className="pos-items-empty-icon" aria-hidden>
                        🛒
                      </div>
                      <strong style={{ color: 'var(--pos-text-sub)' }}>Carrinho vazio</strong>
                      <span>Bipe um produto ou pesquise para começar.</span>
                    </div>
                  ) : (
                    <table className="pos-items-table">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th style={{ width: 140 }}>Quantidade</th>
                          <th style={{ width: 110 }}>Estoque</th>
                          <th style={{ width: 130, textAlign: 'right' }}>Total</th>
                          <th style={{ width: 40 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => {
                          const status = classifyStock(l.stockTotal, l.quantity, l.minStock);
                          const rowClass =
                            status === 'out' ? 'is-out' : status === 'low' ? 'is-low' : '';
                          return (
                            <tr key={l.variantId} className={rowClass}>
                              <td>
                                <div className="pos-item-name">{l.productName}</div>
                                <span className="pos-item-sku">
                                  SKU {l.sku}
                                  {l.barcode ? ` · EAN ${l.barcode}` : ''}
                                </span>
                              </td>
                              <td>
                                <div className="pos-qty-group">
                                  <button
                                    type="button"
                                    className="pos-qty-btn"
                                    onClick={() => updateLineQty(l.variantId, l.quantity - 1)}
                                    aria-label="Diminuir quantidade"
                                  >
                                    −
                                  </button>
                                  <input
                                    className="pos-qty-input"
                                    value={String(l.quantity)}
                                    onChange={(e) => {
                                      const n = parseInt(e.target.value, 10);
                                      if (!Number.isNaN(n) && n >= 0) updateLineQty(l.variantId, n);
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="pos-qty-btn"
                                    onClick={() => updateLineQty(l.variantId, l.quantity + 1)}
                                    aria-label="Aumentar quantidade"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td>
                                <span className={`pos-stock-pill ${status}`}>
                                  {status === 'out'
                                    ? 'Sem estoque'
                                    : status === 'low'
                                      ? `Baixo (${l.stockTotal})`
                                      : `OK (${l.stockTotal})`}
                                </span>
                              </td>
                              <td>
                                <div className="pos-line-money">
                                  {formatBRL(l.unitPrice * l.quantity)}
                                </div>
                                <span className="pos-line-unit">{formatBRL(l.unitPrice)} un</span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="pos-line-remove"
                                  onClick={() => removeLine(l.variantId)}
                                  aria-label="Remover item"
                                  title="Remover"
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  </div>
                </div>
                <div className="pos-cart-footer">
                  <div className="pos-totals-row">
                    <span>Subtotal</span>
                    <strong>{formatBRL(subtotal)}</strong>
                  </div>
                  <div className="pos-totals-row">
                    <span>Desconto</span>
                    <div className="pos-discount-row" style={{ width: 160 }}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={discount || ''}
                        placeholder="0,00"
                        onChange={(e) => setDiscount(Math.max(0, parseDecimal(e.target.value)))}
                      />
                    </div>
                  </div>
                  <div className="pos-totals-divider" />
                  <div className="pos-total-big">
                    <span className="pos-total-big-label">Total</span>
                    <span className="pos-total-big-value">{formatBRL(total)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ---------- COLUNA DIREITA ---------- */}
          <div className="pos-right">
            <button
              type="button"
              className="pos-customer-btn"
              onClick={() => setCustomerOpen(true)}
              title="Selecionar cliente (F4)"
            >
              <span className="pos-customer-avatar" aria-hidden>
                {customer ? customer.name.slice(0, 1).toUpperCase() : '🧍'}
              </span>
              <span style={{ flex: 1 }}>
                {customer ? customer.name : 'Balcão (sem cliente)'}
                <span className="pos-customer-meta" style={{ display: 'block' }}>
                  Clique para alterar <span className="pos-shortcut-key">F4</span>
                </span>
              </span>
            </button>

            <p className="pos-pay-later-hint" role="note">
              As formas de pagamento aparecem após{' '}
              <span className="pos-shortcut-key">F2</span> Finalizar venda ou no botão abaixo.
            </p>

            <button
              type="button"
              className="pos-btn pos-btn-finish"
              onClick={() => {
                if (lines.length === 0 || total <= 0) return;
                setPayments([]);
                setPaymentMenuOpen(true);
              }}
              disabled={lines.length === 0 || total <= 0 || createSale.isPending}
              title="Finalizar venda (F2)"
            >
              {createSale.isPending ? 'Salvando…' : 'Finalizar venda'}
              <span className="pos-shortcut-key">F2</span>
            </button>

            <button
              type="button"
              className="pos-btn pos-btn-danger"
              onClick={() => {
                if (lines.length === 0) return;
                if (confirm('Cancelar venda atual?')) resetSale();
              }}
              disabled={lines.length === 0}
            >
              Cancelar venda
              <span className="pos-shortcut-key">Esc</span>
            </button>
          </div>
        </div>
      </div>

      {/* ---------- DIALOG: cliente ---------- */}
      {customerOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setCustomerOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <h2>Selecionar cliente</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: 'var(--pos-text-sub)' }}>
              Escolha um cliente cadastrado ou mantenha a venda como balcão.
            </p>
            <div className="pos-customer-list">
              <div
                className="pos-customer-item"
                onClick={() => {
                  setCustomer(null);
                  setCustomerOpen(false);
                }}
              >
                <strong>Balcão (sem cliente)</strong>
                <span style={{ color: 'var(--pos-text-muted)', fontSize: '0.85rem' }}>
                  venda anônima
                </span>
              </div>
              {customers.isLoading && (
                <div className="pos-items-empty">Carregando clientes…</div>
              )}
              {customers.data?.map((c) => (
                <div
                  key={c.id}
                  className="pos-customer-item"
                  onClick={() => {
                    setCustomer(c);
                    setCustomerOpen(false);
                  }}
                >
                  <strong>{c.name}</strong>
                  {customer?.id === c.id && (
                    <span className="pos-stock-pill ok">Selecionado</span>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="pos-btn pos-btn-ghost"
                onClick={() => setCustomerOpen(false)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- DIALOG: fechar caixa ---------- */}
      {closeOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setCloseOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640 }}
          >
            <h2>Fechar caixa</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: 'var(--pos-text-sub)' }}>
              Informe os valores apresentados pelo operador em cada forma de pagamento.
              Caixa aberto em <strong>{formatDate(session.openedAt)}</strong> com saldo
              inicial de <strong>{formatBRL(session.openingBalance)}</strong>.
            </p>
            {closeErr && <div className="alert alert-error">{closeErr}</div>}

            <div className="pos-close-grid">
              {CLOSE_ROWS.map((m) => {
                const expected = closeDetailQ.data?.summary.byMethod[m.key] ?? 0;
                // Para o dinheiro, o "esperado" mais útil é fundo + vendas em dinheiro.
                const expectedDisplay =
                  m.key === 'CASH'
                    ? expected + parseDecimal(session.openingBalance)
                    : expected;
                const counted = parseDecimal(closingByMethod[m.key]);
                const diff = counted - expectedDisplay;
                const inputId = `close-${m.key.toLowerCase()}`;
                return (
                  <div key={m.key} className="pos-close-row">
                    <label htmlFor={inputId} className="pos-close-row-method">
                      <span className="pos-close-row-icon" aria-hidden>
                        {m.icon}
                      </span>
                      <span>
                        <strong>{m.label}</strong>
                        <em>
                          Esperado
                          {m.key === 'CASH'
                            ? ' (fundo + vendas)'
                            : m.key === 'EXPENSE'
                              ? ' (despesas lançadas)'
                              : ''}
                          :{' '}
                          {closeDetailQ.isLoading ? '…' : formatBRL(expectedDisplay)}
                        </em>
                      </span>
                    </label>
                    <input
                      id={inputId}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={closingByMethod[m.key]}
                      onChange={(e) =>
                        setClosingByMethod((prev) => ({ ...prev, [m.key]: e.target.value }))
                      }
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <div
                      className={
                        'pos-close-row-diff ' +
                        (counted === 0
                          ? 'is-neutral'
                          : Math.abs(diff) < 0.005
                            ? 'is-ok'
                            : diff > 0
                              ? 'is-over'
                              : 'is-short')
                      }
                    >
                      {counted === 0 ? (
                        <span>—</span>
                      ) : Math.abs(diff) < 0.005 ? (
                        <span>OK</span>
                      ) : (
                        <span>
                          {diff > 0 ? '+' : ''}
                          {formatBRL(diff)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pos-close-totals">
              <span>Total declarado</span>
              <strong>{formatBRL(closingTotal)}</strong>
            </div>

            <div className="field" style={{ marginTop: '0.5rem' }}>
              <label htmlFor="closing-notes">Observações (opcional)</label>
              <textarea
                id="closing-notes"
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                rows={2}
                placeholder="Ex.: faltou troco às 15h, diferença de R$ 5 em cartão por estorno…"
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="pos-btn pos-btn-ghost"
                onClick={() => setCloseOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="pos-btn pos-btn-finish"
                style={{ minHeight: 44, padding: '0.7rem 1.2rem' }}
                disabled={closeCash.isPending}
                onClick={() => closeCash.mutate()}
              >
                {closeCash.isPending ? 'Fechando…' : 'Confirmar fechamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- DRAWER: histórico ---------- */}
      {historyOpen && (
        <div
          className="pos-history-drawer"
          role="presentation"
          onClick={() => {
            setHistoryOpen(false);
            setSaleLineRemoveDraft(null);
          }}
        >
          <div
            className="pos-history-panel"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pos-history-header">
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Vendas recentes</h2>
              <button
                type="button"
                className="pos-btn pos-btn-ghost"
                onClick={() => {
                  setHistoryOpen(false);
                  setSaleLineRemoveDraft(null);
                }}
              >
                Fechar
              </button>
            </div>
            <div className="pos-history-list">
              {sales.isLoading && <div className="pos-items-empty">Carregando…</div>}
              {!sales.isLoading && !sales.data?.length && (
                <div className="pos-items-empty">Nenhuma venda ainda.</div>
              )}
              {sales.data?.map((s) => {
                const rows = s.items ?? [];
                return (
                  <div key={s.id} className="pos-history-stack">
                    <div className="pos-history-row">
                      <span className="pos-history-num">#{s.number}</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{s.customer?.name ?? 'Balcão'}</div>
                        <div className="pos-history-meta">{formatDate(s.createdAt)}</div>
                      </div>
                      <span
                        className={
                          'pos-stock-pill ' +
                          (s.status === 'COMPLETED'
                            ? 'ok'
                            : s.status === 'CANCELLED'
                              ? 'out'
                              : 'low')
                        }
                      >
                        {s.status === 'COMPLETED'
                          ? 'OK'
                          : s.status === 'CANCELLED'
                            ? 'Cancelada'
                            : 'Rascunho'}
                      </span>
                      <span className="pos-history-total">{formatBRL(s.total)}</span>
                      {rows.length > 0 && (
                        <ul className="pos-history-items-preview">
                          {rows.map((it) => (
                            <li key={it.id}>
                              <span>
                                {it.variant.product.name} · SKU {it.variant.sku}
                              </span>
                              <span>
                                qty {parseDecimal(it.quantity).toLocaleString('pt-BR')} ·{' '}
                                {formatBRL(it.totalLine)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {(s.status === 'COMPLETED' || s.status === 'CANCELLED') && (
                        <div className="pos-history-actions">
                          <button
                            type="button"
                            className="pos-btn pos-btn-ghost pos-history-action-print"
                            onClick={() => {
                              queueSaleReceiptAutoPrint(s.id);
                              setHistoryOpen(false);
                              setSaleLineRemoveDraft(null);
                              window.setTimeout(() => scannerRef.current?.focus(), 0);
                            }}
                          >
                            Cupom (não fiscal)
                          </button>
                          {s.status === 'COMPLETED' && canManagePastSales && (
                            <>
                              {rows.length >= 2 && (
                                <button
                                  type="button"
                                  className="pos-btn pos-btn-ghost pos-history-action-warn"
                                  disabled={removeSaleLineMut.isPending}
                                  title="Escolha qual linha sairá do cupom; totais serão recalculados."
                                  onClick={() => {
                                    setSaleLineRemoveDraft({
                                      sale: s,
                                      selectedItemId: rows[0]!.id,
                                    });
                                  }}
                                >
                                  Remover um item…
                                </button>
                              )}
                              <button
                                type="button"
                                className="pos-btn pos-btn-ghost pos-history-action-danger"
                                disabled={cancelSale.isPending}
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Cancelar integralmente a venda #${s.number}?\n\n` +
                                        `Todo o pedido será anulado, todo o estoque desta venda volta ao inventário ` +
                                        `e eventuais títulos de crediário vinculados a este cupom serão removidos.`,
                                    )
                                  ) {
                                    cancelSale.mutate(s.id);
                                  }
                                }}
                              >
                                Cancelar venda inteira
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {saleLineRemoveDraft && (
        <div
          className="modal-backdrop"
          role="presentation"
          style={{ zIndex: 70 }}
          onClick={() =>
            removeSaleLineMut.isPending ? undefined : setSaleLineRemoveDraft(null)
          }
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-rem-line-title"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(480px, 94vw)' }}
          >
            <h2 id="pos-rem-line-title" style={{ marginTop: 0, fontSize: '1.05rem' }}>
              Remover item da venda #{saleLineRemoveDraft.sale.number}
            </h2>
            <p style={{ fontSize: '0.86rem', color: 'var(--color-text-muted, #64748b)' }}>
              Escolha a linha a retirar do cupom. O subtotal e o total são recalculados e os valores
              de pagamento podem ser ajustados automaticamente quando houver parte em{' '}
              <strong>dinheiro</strong>.
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--pos-danger)', marginTop: 0 }}>
              Não disponível para vendas com <strong>crediário</strong> — cancele a venda inteira ou
              ajuste no financeiro.
            </p>
            <div className="field">
              <label htmlFor="pos-rem-line-select">Linha na venda</label>
              <select
                id="pos-rem-line-select"
                value={saleLineRemoveDraft.selectedItemId}
                onChange={(e) =>
                  setSaleLineRemoveDraft((prev) =>
                    prev ? { ...prev, selectedItemId: e.target.value } : prev,
                  )
                }
              >
                {(saleLineRemoveDraft.sale.items ?? []).map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.variant.product.name} · SKU {it.variant.sku} · qty{' '}
                    {parseDecimal(it.quantity)} · {formatBRL(it.totalLine)}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="pos-btn pos-btn-ghost"
                disabled={removeSaleLineMut.isPending}
                onClick={() => setSaleLineRemoveDraft(null)}
              >
                Voltar
              </button>
              <button
                type="button"
                className="pos-btn pos-btn-finish"
                disabled={removeSaleLineMut.isPending}
                onClick={() => {
                  if (
                    !confirm(
                      'Confirmar remoção deste item?\nSerá aplicado novo total e nova divisão das formas de pagamento.',
                    )
                  )
                    return;
                  removeSaleLineMut.mutate({
                    saleId: saleLineRemoveDraft.sale.id,
                    itemId: saleLineRemoveDraft.selectedItemId,
                  });
                }}
              >
                {removeSaleLineMut.isPending ? 'Aplicando…' : 'Confirmar remoção'}
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentMenuOpen && (
        <PaymentOverlay
          total={total}
          subtotal={subtotal}
          discount={discount}
          itemsCount={lines.length}
          customerName={customer?.name ?? null}
          payments={payments}
          remaining={remaining}
          change={change}
          isFinishing={createSale.isPending}
          onAddPayment={(p) => setPayments((prev) => [...prev, p])}
          onRemovePayment={(id) => setPayments((prev) => prev.filter((x) => x.id !== id))}
          onCancel={() => setPaymentMenuOpen(false)}
          onConfirm={() => createSale.mutate()}
        />
      )}

      <PosPrintPrefsModal
        open={printPrefsOpen}
        onClose={() => setPrintPrefsOpen(false)}
        companyAutoPrint={companyQ.data?.saleReceiptAutoPrint ?? false}
      />

      {toast && (
        <div className={`pos-toast ${toast.kind === 'err' ? 'is-error' : ''}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Preferências de impressão do cupom na estação (localStorage)
 * ------------------------------------------------------------------------- */

function PosPrintPrefsModal({
  open,
  onClose,
  companyAutoPrint,
}: {
  open: boolean;
  onClose: () => void;
  companyAutoPrint: boolean;
}) {
  const [mode, setMode] = useState<PosAutoPrintMode>('inherit');
  useEffect(() => {
    if (open) setMode(getPosAutoPrintMode());
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => onClose()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 480 }}
      >
        <h2 style={{ marginTop: 0 }}>Impressão do cupom nesta máquina</h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.86rem', color: 'var(--pos-text-sub)' }}>
          Com o sistema na nuvem, o cupom{' '}
          <strong>sempre sai pela impressora do computador onde o PDV está aberto</strong>. O
          navegador usa a impressora padrão do Windows/macOS ou a que você escolher no diálogo
          &quot;Imprimir&quot;. Não há como o servidor remoto apontar diretamente para uma USB local.
        </p>
        <p style={{ margin: '0 0 0.9rem', fontSize: '0.8rem', color: 'var(--pos-text-muted)' }}>
          Padrão definido em <strong>Empresa</strong>:{' '}
          {companyAutoPrint
            ? 'impressão automática após cada venda.'
            : 'só imprimir quando o operador pedir.'}
        </p>
        <fieldset
          style={{
            border: '1px solid var(--pos-border)',
            borderRadius: 8,
            padding: '0.65rem 0.85rem',
            margin: 0,
          }}
        >
          <legend style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0 0.25rem' }}>
            Neste caixa (permanece neste navegador)
          </legend>
          {(['inherit', 'on', 'off'] as const).map((m) => (
            <label
              key={m}
              style={{
                display: 'flex',
                gap: '0.45rem',
                alignItems: 'flex-start',
                margin: '0.4rem 0',
                fontSize: '0.88rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="gv-pos-autoprint"
                checked={mode === m}
                onChange={() => setMode(m)}
                style={{ marginTop: '0.12rem' }}
              />
              <span>{posAutoPrintModeLabel(m)}</span>
            </label>
          ))}
        </fieldset>
        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button type="button" className="pos-btn pos-btn-ghost" onClick={() => onClose()}>
            Cancelar
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-finish"
            style={{ minHeight: 44 }}
            onClick={() => {
              setPosAutoPrintMode(mode);
              onClose();
            }}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Topbar do PDV (versão full-screen) — info de caixa, atalhos, ações
 * ------------------------------------------------------------------------- */

function PosTopbar({
  session,
  operator,
  salesToday,
  receiptAutoSummary,
  onOpenPrintPrefs,
  onOpenHistory,
  onExit,
  onCloseCash,
}: {
  session: CashSession;
  operator: Operator | null;
  salesToday: number;
  receiptAutoSummary: string;
  onOpenPrintPrefs: () => void;
  onOpenHistory: () => void;
  onExit: () => void;
  onCloseCash: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="pos-topbar">
      <div className="pos-topbar-info">
        <span>
          <strong>PDV</strong>
        </span>
        {operator && (
          <span className="pos-topbar-operator" title={operator.email}>
            <span className="pos-topbar-operator-avatar" aria-hidden>
              {operator.name.trim().slice(0, 1).toUpperCase()}
            </span>
            <span className="pos-topbar-operator-text">
              <strong>{operator.name}</strong>
              <em>{profileLabel(operator.profile)}</em>
            </span>
          </span>
        )}
        <span className="pos-topbar-cash">
          ● Caixa aberto · fundo {formatBRL(session.openingBalance)}
        </span>
        <span>
          {now.toLocaleDateString('pt-BR')}{' '}
          <strong>
            {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </strong>
        </span>
        <span>
          Vendas hoje: <strong>{salesToday}</strong>
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--pos-text-muted)' }}>
          <span className="pos-shortcut-key">F2</span> finalizar ·{' '}
          <span className="pos-shortcut-key">F4</span> cliente ·{' '}
          <span className="pos-shortcut-key">F8</span> desconto ·{' '}
          <span className="pos-shortcut-key">Esc</span> cancelar
        </span>
        <span
          className="pos-topbar-print-hint"
          title="Clique em Impressão para mudar o comportamento neste computador"
        >
          {receiptAutoSummary}
        </span>
      </div>
      <div className="pos-topbar-actions">
        <button
          type="button"
          className="pos-btn pos-btn-ghost"
          onClick={onOpenPrintPrefs}
          title="Preferências de cupom nesta máquina"
        >
          Impressão
        </button>
        <button type="button" className="pos-btn pos-btn-ghost" onClick={onOpenHistory}>
          Vendas recentes
        </button>
        <button type="button" className="pos-btn pos-btn-ghost" onClick={onCloseCash}>
          Fechar caixa
        </button>
        <button type="button" className="pos-topbar-exit" onClick={onExit}>
          ← Sair
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * PaymentOverlay — submenu de pagamento em tela cheia (acionado por F2)
 * ------------------------------------------------------------------------- */

function PaymentOverlay({
  total,
  subtotal,
  discount,
  itemsCount,
  customerName,
  payments,
  remaining,
  change,
  isFinishing,
  onAddPayment,
  onRemovePayment,
  onCancel,
  onConfirm,
}: {
  total: number;
  subtotal: number;
  discount: number;
  itemsCount: number;
  customerName: string | null;
  payments: CartPayment[];
  remaining: number;
  change: number;
  isFinishing: boolean;
  onAddPayment: (p: CartPayment) => void;
  onRemovePayment: (id: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [method, setMethod] = useState<PaymentKind>('CASH');
  const [amountStr, setAmountStr] = useState('');
  const [installments, setInstallments] = useState('1');
  const amountInputRef = useRef<HTMLInputElement>(null);

  const fullyPaid = Math.abs(remaining) <= 0.005;
  const canFinish = total > 0 && fullyPaid;

  // Foca o campo de valor ao abrir e quando muda o método.
  useEffect(() => {
    amountInputRef.current?.focus();
    amountInputRef.current?.select();
  }, [method]);

  function addPayment(opts?: { fullAmount?: boolean }) {
    const parsed = parseDecimal(amountStr);
    const value = opts?.fullAmount || parsed <= 0 ? remaining : parsed;
    if (value <= 0) return;
    onAddPayment({
      id: uid(),
      method,
      amount: Math.round(value * 100) / 100,
      installments: parseInt(installments, 10) || 1,
    });
    setAmountStr('');
    // Mantém o foco no campo para o próximo lançamento (vendas com troco/divisão).
    setTimeout(() => amountInputRef.current?.focus(), 0);
  }

  // Atalhos da overlay: 1-5 = método, F2/Enter = confirmar, Esc = voltar
  useEffect(() => {
    function onKey(ev: globalThis.KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onCancel();
        return;
      }
      if (ev.key === 'F2') {
        ev.preventDefault();
        if (canFinish && !isFinishing) onConfirm();
        return;
      }
      // 1-5 para escolher método (só funciona fora de input numérico, mas
      // como o campo aceita decimais, vamos bloquear se for "dígito de método")
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isInputFocused = tag === 'input' || tag === 'select' || tag === 'textarea';

      if (!isInputFocused) {
        const map: Record<string, PaymentKind> = {
          '1': 'CASH',
          '2': 'CARD',
          '3': 'PIX',
          '4': 'CREDIT',
          '5': 'OTHER',
        };
        if (map[ev.key]) {
          ev.preventDefault();
          setMethod(map[ev.key]);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canFinish, isFinishing, onCancel, onConfirm]);

  return (
    <div className="pos-payment-overlay" role="dialog" aria-modal="true">
      <div className="pos-payment-shell">
        <div className="pos-payment-header">
          <div>
            <span className="pos-payment-eyebrow">Finalizar venda</span>
            <h2>
              {itemsCount} {itemsCount === 1 ? 'item' : 'itens'}
              {customerName ? ` · ${customerName}` : ''}
            </h2>
          </div>
          <button type="button" className="pos-btn pos-btn-ghost" onClick={onCancel}>
            ✕ Voltar <span className="pos-shortcut-key">Esc</span>
          </button>
        </div>

        <div className="pos-payment-total">
          <span className="pos-payment-total-label">Total a pagar</span>
          <span className="pos-payment-total-value">{formatBRL(total)}</span>
          {discount > 0 && (
            <span className="pos-payment-total-detail">
              Subtotal {formatBRL(subtotal)} · desconto {formatBRL(discount)}
            </span>
          )}
        </div>

        <div className="pos-payment-body">
          <div className="pos-payment-methods-grid">
            {PAY_METHODS.map((m, i) => (
              <button
                key={m.key}
                type="button"
                className={`pos-payment-tile ${method === m.key ? 'is-active' : ''}`}
                onClick={() => setMethod(m.key)}
              >
                <span className="pos-payment-tile-shortcut">{i + 1}</span>
                <span className="pos-payment-tile-icon" aria-hidden>
                  {m.icon}
                </span>
                <span className="pos-payment-tile-label">{m.label}</span>
              </button>
            ))}
          </div>

          <div className="pos-payment-controls">
            <div className="pos-payment-field">
              <label htmlFor="pay-overlay-amount">
                Valor recebido em {PAY_METHODS.find((m) => m.key === method)?.label}
              </label>
              <input
                ref={amountInputRef}
                id="pay-overlay-amount"
                inputMode="decimal"
                value={amountStr}
                placeholder={`${formatBRL(remaining)} (restante)`}
                onChange={(e) => setAmountStr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPayment();
                  }
                }}
              />
            </div>
            {method === 'CREDIT' && (
              <div className="pos-payment-field" style={{ maxWidth: 130 }}>
                <label htmlFor="pay-overlay-inst">Parcelas</label>
                <input
                  id="pay-overlay-inst"
                  type="number"
                  min={1}
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                />
              </div>
            )}
            <button
              type="button"
              className="pos-btn pos-btn-ghost"
              style={{ alignSelf: 'flex-end', minHeight: 52 }}
              onClick={() => addPayment()}
              disabled={remaining <= 0}
            >
              + Adicionar
            </button>
            <button
              type="button"
              className="pos-btn pos-btn-ghost"
              style={{ alignSelf: 'flex-end', minHeight: 52 }}
              onClick={() => addPayment({ fullAmount: true })}
              disabled={remaining <= 0}
              title="Lançar o valor restante neste método"
            >
              Restante
            </button>
          </div>

          {payments.length > 0 && (
            <div className="pos-payment-list">
              {payments.map((p) => {
                const meta = PAY_METHODS.find((m) => m.key === p.method);
                return (
                  <div key={p.id} className="pos-payment-row">
                    <span aria-hidden>{meta?.icon}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>
                      {meta?.label}
                      {p.method === 'CREDIT' && p.installments > 1 && ` · ${p.installments}×`}
                    </span>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatBRL(p.amount)}
                    </strong>
                    <button
                      type="button"
                      className="pos-pay-row-remove"
                      onClick={() => onRemovePayment(p.id)}
                      aria-label="Remover"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pos-payment-summary">
            <div className={fullyPaid ? 'is-paid' : 'is-missing'}>
              <span>{fullyPaid ? (change > 0 ? 'Troco' : 'Pago') : 'Faltam'}</span>
              <strong>
                {formatBRL(fullyPaid ? change : remaining)}
              </strong>
            </div>
          </div>
        </div>

        <div className="pos-payment-footer">
          <span className="pos-payment-tip">
            Atalhos: <span className="pos-shortcut-key">1</span>–
            <span className="pos-shortcut-key">5</span> método ·{' '}
            <span className="pos-shortcut-key">Enter</span> adicionar valor ·{' '}
            <span className="pos-shortcut-key">F2</span> confirmar ·{' '}
            <span className="pos-shortcut-key">Esc</span> voltar
          </span>
          <button
            type="button"
            className="pos-btn pos-btn-finish"
            disabled={!canFinish || isFinishing}
            onClick={onConfirm}
          >
            {isFinishing ? 'Salvando…' : 'Confirmar venda'}
            <span className="pos-shortcut-key">F2</span>
          </button>
        </div>
      </div>
    </div>
  );
}
