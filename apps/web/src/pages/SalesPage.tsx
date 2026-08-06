import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { PermissionPasswordModal } from '../components/PermissionPasswordModal';
import { PdvProceduresOverlay } from '../components/PdvProceduresOverlay';
import { api } from '../lib/api';
import {
  companyDisplayName,
  companyUsesCustomLogo,
  useCompanyBranding,
} from '../lib/company-branding';
import { hasRestaurantPlan, isAdmin, isManager, profileLabel, type UserProfile } from '../lib/auth';
import { calcRestaurantFees, type RestaurantFeesCompany } from '../lib/restaurant-fees';
import { formatServiceTabLabel } from '../lib/service-tab';
import {
  hasUserPermission,
  type UserPermissionsResponse,
} from '../lib/user-permissions';
import { formatBRL, formatDate } from '../lib/format';
import {
  expectedFinalForReconKey,
  formatCashExpectedHint,
  sumDeclaredForClosingBalance,
  type CashMovementBreakdown,
} from '../lib/cash-reconciliation';
import {
  effectiveAutoPrintAfterSale,
  getPosAutoPrintMode,
  posAutoPrintModeLabel,
  queueSaleReceiptAutoPrint,
  setPosAutoPrintMode,
  type PosAutoPrintMode,
} from '../lib/sale-receipt-print';
import { isGestorVendDesktop } from '../lib/desktop-bridge';
import { parseBarcodeWeight, type ScaleMode } from '../lib/pos-scale';
import { usePosScale } from '../lib/use-pos-scale';
import {
  calcAdminFee,
  cardBrandLabel,
  cardOperationLabel,
  isCustomerCreditKind,
  kindIcon,
  type PaymentForm,
} from '../lib/payment-forms';
import './pos.css';

const GV_POS_CHECKOUT_FAILURE_KEY = 'gv_pos_checkout_failure_v1';
/** Comanda pendente de cobrança no PDV (sobrevive ao gateway de abertura de caixa). */
const GV_PDV_COMANDA_KEY = 'gv_pdv_comanda';

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
  fiscalIntegrationError?: string | null;
  fiscalDocument?: {
    id: string;
    kind: 'NFC_E' | 'NF_E';
    status: string;
    accessKey: string | null;
    lastError: string | null;
  } | null;
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
  productControlNumber?: number;
  /** Unidade tributável (UN, KG, G, L…). */
  taxUnit?: string | null;
  variantId: string;
  sku: string;
  barcode: string | null;
  retailPrice: string;
  promoPrice: string | null;
  costAverage: string;
  stockTotal: string;
  minStock: string;
};

type Customer = {
  id: string;
  name: string;
  creditLimit?: string;
  requisitionLimit?: string;
  creditAvailable?: string;
  requisitionAvailable?: string;
};
type CustomerSearchRow = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  creditLimit?: string;
  requisitionLimit?: string;
  creditAvailable?: string;
  requisitionAvailable?: string;
};

type PaymentKind = 'CASH' | 'CARD' | 'PIX' | 'CREDIT' | 'REQUISITION' | 'OTHER';

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
  /** Desconto da linha em R$ (sempre absoluto; % é convertido na UI). */
  discount: number;
  stockTotal: number;
  minStock: number;
  /** Unidade tributável — controla qty fracionada no PDV. */
  taxUnit: string;
  /** Item veio da comanda: estoque já baixado no salão — não alertar no PDV. */
  fromComanda?: boolean;
};

type CartPayment = {
  id: string;
  method: PaymentKind;
  amount: number;
  installments: number;
  paymentFormId?: string | null;
  paymentFormName?: string | null;
};

/* ----------------------------------------------------------------------------
 * Constantes / utilitários
 * ------------------------------------------------------------------------- */

/** Inclui `EXPENSE` só no fechamento (não é forma de pagamento de venda). */
type CloseMethodKey = PaymentKind | 'EXPENSE';

const PAY_METHODS: Array<{ key: PaymentKind; label: string; icon: string }> = [
  { key: 'CASH', label: 'Dinheiro', icon: '💵' },
  { key: 'CARD', label: 'Cartão', icon: '💳' },
  { key: 'PIX', label: 'Pix', icon: '⚡' },
  { key: 'CREDIT', label: 'Crediário', icon: '🧾' },
  { key: 'REQUISITION', label: 'Requisição', icon: '📋' },
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

/** Unidades que aceitam quantidade fracionada no PDV (peso/volume). */
const FRACTIONAL_TAX_UNITS = new Set([
  'KG',
  'G',
  'GR',
  'MG',
  'T',
  'TON',
  'L',
  'LT',
  'ML',
]);

function normalizeTaxUnit(taxUnit: string | null | undefined): string {
  const u = (taxUnit ?? 'UN').trim().toUpperCase();
  return u || 'UN';
}

function isFractionalTaxUnit(taxUnit: string | null | undefined): boolean {
  return FRACTIONAL_TAX_UNITS.has(normalizeTaxUnit(taxUnit));
}

function qtyStepForUnit(taxUnit: string | null | undefined): number {
  const u = normalizeTaxUnit(taxUnit);
  if (u === 'G' || u === 'GR' || u === 'MG' || u === 'ML') return 1;
  if (isFractionalTaxUnit(u)) return 0.1;
  return 1;
}

function qtyUnitLabel(taxUnit: string | null | undefined): string {
  const u = normalizeTaxUnit(taxUnit);
  if (u === 'KG') return 'kg';
  if (u === 'G' || u === 'GR') return 'g';
  if (u === 'MG') return 'mg';
  if (u === 'L' || u === 'LT') return 'L';
  if (u === 'ML') return 'ml';
  if (u === 'T' || u === 'TON') return 't';
  return u.toLowerCase();
}

/** Arredonda qty: 3 casas p/ fracionados; inteiro p/ UN etc. */
function roundCartQty(qty: number, taxUnit: string | null | undefined): number {
  if (!Number.isFinite(qty) || qty < 0) return 0;
  if (isFractionalTaxUnit(taxUnit)) {
    return Math.round(qty * 1000) / 1000;
  }
  return Math.round(qty);
}

function formatCartQty(qty: number, taxUnit: string | null | undefined): string {
  if (isFractionalTaxUnit(taxUnit)) {
    return qty.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  }
  return String(qty);
}

function classifyStock(stock: number, qtyInCart: number, minStock: number) {
  const remaining = stock - qtyInCart;
  if (remaining <= 0) return 'out';
  if (remaining < minStock) return 'low';
  return 'ok';
}

function fiscalDocumentStatusPt(status: string): string {
  const m: Record<string, string> = {
    QUEUED: 'na fila',
    BUILDING_XML: 'montando XML',
    SENT: 'enviado à SEFAZ',
    AUTHORIZED: 'autorizado',
    REJECTED: 'rejeitado',
    ERROR: 'erro',
    CANCELLED: 'cancelado',
  };
  return m[status] ?? status;
}

function fiscalDocumentKindPt(kind: string): string {
  return kind === 'NF_E' ? 'NF-e' : 'NFC-e';
}

/* ----------------------------------------------------------------------------
 * Página principal — decide entre Gateway de Caixa e PDV
 * ------------------------------------------------------------------------- */

function peekPendingPdvComandaId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('comanda')?.trim();
    if (fromUrl) return fromUrl;
    return sessionStorage.getItem(GV_PDV_COMANDA_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export function SalesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();

  const [localFailBump, setLocalFailBump] = useState(0);

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

  const localCheckoutFailureMessage = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(GV_POS_CHECKOUT_FAILURE_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw) as { message?: string };
      return typeof j.message === 'string' ? j.message : raw;
    } catch {
      return sessionStorage.getItem(GV_POS_CHECKOUT_FAILURE_KEY);
    }
  }, [localFailBump]);

  const pdvReadinessQ = useQuery({
    queryKey: ['cash', 'pdv-readiness'],
    queryFn: () =>
      api<{
        allowed: boolean;
        blockReason: string | null;
        pdvDocumentMode: string;
      }>('/cash/pdv-readiness'),
    enabled: !entered,
    refetchOnMount: 'always',
  });

  const gatewayBlocked =
    Boolean(localCheckoutFailureMessage) ||
    Boolean(pdvReadinessQ.data && !pdvReadinessQ.data.allowed);

  const gatewayBlockMessages = [
    localCheckoutFailureMessage,
    pdvReadinessQ.data && !pdvReadinessQ.data.allowed ? pdvReadinessQ.data.blockReason : null,
  ].filter(Boolean) as string[];

  function exitToDashboard() {
    navigate('/');
  }

  function enterPdv() {
    if (gatewayBlocked) return;
    setEntered(true);
    setGatewayNotice(null);
  }

  // Sessão ativa = existe no cache E está com status OPEN (sanity check).
  const activeSession =
    sessionQ.data && sessionQ.data.status === 'OPEN' ? sessionQ.data : null;

  const operator = operatorQ.data ?? null;

  const pendingComandaId =
    searchParams.get('comanda')?.trim() || peekPendingPdvComandaId();

  /**
   * Cobrar no PDV: se já há caixa aberto e veio comanda na URL/storage,
   * entra direto no PDV (sem parar no gateway) para carregar a comanda.
   */
  useEffect(() => {
    if (entered || gatewayBlocked || sessionQ.isLoading) return;
    if (!activeSession || !pendingComandaId) return;
    setEntered(true);
  }, [
    entered,
    gatewayBlocked,
    sessionQ.isLoading,
    activeSession,
    pendingComandaId,
  ]);

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
        pendingComanda={Boolean(pendingComandaId)}
        isManagerView={managerView}
        openSessions={openSessionsQ.data ?? []}
        currentUserId={operator?.id ?? null}
        gatewayBlocked={gatewayBlocked}
        gatewayBlockMessages={gatewayBlockMessages}
        onDismissCheckoutFailure={() => {
          sessionStorage.removeItem(GV_POS_CHECKOUT_FAILURE_KEY);
          setLocalFailBump((n) => n + 1);
        }}
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
  const company = useCompanyBranding();
  const storeName = companyDisplayName(company.data);

  return (
    <div className="pos-gateway-header">
        <div className="pos-gateway-brand">
          <CompanyLogo
            className="pos-gateway-brand-mark"
            company={company.data ?? null}
            alt={storeName}
          />
          <div className="pos-gateway-brand-aside">
            {companyUsesCustomLogo(company.data) ? (
              <span className="pos-gateway-brand-name">{storeName}</span>
            ) : null}
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
  pendingComanda,
  isManagerView,
  openSessions,
  currentUserId,
  gatewayBlocked,
  gatewayBlockMessages,
  onDismissCheckoutFailure,
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
  pendingComanda?: boolean;
  isManagerView: boolean;
  openSessions: OpenSessionSummary[];
  currentUserId: string | null;
  gatewayBlocked: boolean;
  gatewayBlockMessages: string[];
  onDismissCheckoutFailure: () => void;
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

          {pendingComanda && (
            <div
              role="status"
              style={{
                marginBottom: '1rem',
                padding: '0.85rem 1rem',
                borderRadius: 10,
                background: 'rgba(34, 197, 94, 0.18)',
                border: '1px solid rgba(134, 239, 172, 0.45)',
                color: '#bbf7d0',
                fontSize: '0.92rem',
                lineHeight: 1.45,
              }}
            >
              <strong style={{ display: 'block', marginBottom: '0.25rem' }}>
                Cobrança de comanda pendente
              </strong>
              {hasOpen
                ? 'Entre no PDV para carregar a comanda e finalizar com F2.'
                : 'Abra o caixa abaixo; a comanda será carregada automaticamente no PDV.'}
            </div>
          )}

          {gatewayBlocked && gatewayBlockMessages.length > 0 && (
            <div
              role="alert"
              style={{
                marginBottom: '1rem',
                padding: '0.85rem 1rem',
                borderRadius: 10,
                background: 'rgba(220, 38, 38, 0.22)',
                border: '1px solid rgba(252,165,165,0.5)',
                color: '#fecaca',
                fontSize: '0.92rem',
                lineHeight: 1.45,
              }}
            >
              <strong style={{ display: 'block', marginBottom: '0.45rem' }}>PDV e caixa bloqueados nesta estação</strong>
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {gatewayBlockMessages.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
              <div style={{ marginTop: '0.65rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="pos-gateway-btn pos-gateway-btn-secondary" onClick={onDismissCheckoutFailure}>
                  Limpar aviso da última tentativa (neste navegador)
                </button>
                <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>
                  Pendências gravadas na venda exigem ação do gerente: menu <strong>Vendas</strong> → cancelar erro fiscal ou usar a API «limpar fiscal».
                </span>
              </div>
            </div>
          )}

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
                {pendingComanda
                  ? 'Entrar no PDV para cobrar a comanda do salão (F2).'
                  : 'Retomar o atendimento no caixa que ficou aberto do último uso.'}
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
                  disabled={!hasOpen || isFetching || gatewayBlocked}
                  onClick={onEnter}
                  title={
                    gatewayBlocked
                      ? 'Regularize pendências antes de operar.'
                      : isFetching
                      ? 'Atualizando status do caixa…'
                      : hasOpen
                        ? 'Entrar no PDV'
                        : 'Não há caixa aberto'
                  }
                >
                  {isFetching && !hasOpen
                    ? 'Verificando…'
                    : pendingComanda
                      ? 'Cobrar comanda no PDV'
                      : 'Entrar no PDV'}
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
                    if (e.key === 'Enter' && !hasOpen && !gatewayBlocked) openMut.mutate();
                  }}
                  placeholder="0,00"
                />
              </div>

              <div className="pos-gateway-card-cta">
                <button
                  type="button"
                  className="pos-gateway-btn pos-gateway-btn-secondary"
                  disabled={hasOpen || openMut.isPending || gatewayBlocked}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  /* --- estado do carrinho atual --- */
  const [lines, setLines] = useState<CartLine[]>([]);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  /** Rascunho de qty enquanto digita (permite "0," / "1,25"). */
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [focusQtyVariantId, setFocusQtyVariantId] = useState<string | null>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [discount, setDiscount] = useState(0);
  const [surcharge, setSurcharge] = useState(0);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [payments, setPayments] = useState<CartPayment[]>([]);
  /** Comanda do salão sendo cobrada neste PDV (fecha após a venda). */
  const [serviceTab, setServiceTab] = useState<{
    id: string;
    number: number;
    displayName: string;
    label: string;
    guestCount: number;
  } | null>(null);
  const serviceTabRef = useRef(serviceTab);
  serviceTabRef.current = serviceTab;
  const serviceTabLoadedRef = useRef<string | null>(null);
  const [tabLookup, setTabLookup] = useState('');
  const [tabLookupBusy, setTabLookupBusy] = useState(false);
  const [tabCandidates, setTabCandidates] = useState<
    Array<{ id: string; number: number; tableLabel: string; itemCount: number; total: number }>
  >([]);

  /* --- estado da UI --- */
  const [scannerValue, setScannerValue] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSearchIdx, setCustomerSearchIdx] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closingByMethod, setClosingByMethod] = useState<Record<CloseMethodKey, string>>({
    CASH: '',
    CARD: '',
    PIX: '',
    CREDIT: '',
    REQUISITION: '',
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
  /** Overlay F3: sangria / despesa / suprimento no caixa aberto. */
  const [proceduresOpen, setProceduresOpen] = useState(false);
  /** Modal de desconto por item (R$ ou %). */
  const [itemDiscountDraft, setItemDiscountDraft] = useState<{
    variantId: string;
    mode: 'BRL' | 'PCT';
    value: string;
  } | null>(null);
  /** Após concluir venda: atalho para cupom não fiscal (bobina térmica). */
  const [receiptPrompt, setReceiptPrompt] = useState<{ id: string; number: number } | null>(null);

  const [printPrefsOpen, setPrintPrefsOpen] = useState(false);

  const scannerRef = useRef<HTMLInputElement>(null);
  const customerSearchRef = useRef<HTMLInputElement>(null);

  /** Devoluções / ajustes de vendas já concluídas (API: admin/manager). */
  const [saleLineRemoveDraft, setSaleLineRemoveDraft] = useState<{
    sale: SaleSummary;
    selectedItemId: string;
  } | null>(null);
  const canManagePastSales = isManager();
  const [permModal, setPermModal] = useState<
    | null
    | { kind: 'discount_finish' }
    | { kind: 'cancel_sale'; saleId: string; saleNumber: number }
    | { kind: 'fiscal_cancel'; docId: string; saleNumber: number }
  >(null);
  const [permModalError, setPermModalError] = useState<string | null>(null);

  /* --- queries --- */

  const permissionsQ = useQuery({
    queryKey: ['users', 'me', 'permissions'],
    queryFn: () => api<UserPermissionsResponse>('/users/me/permissions'),
    staleTime: 30_000,
  });

  const canApplyDiscount =
    isAdmin() || hasUserPermission(permissionsQ.data, 'SALE_DISCOUNT');
  const canCancelSale =
    isAdmin() || hasUserPermission(permissionsQ.data, 'SALE_CANCEL');
  const canCancelFiscalDoc =
    isAdmin() || hasUserPermission(permissionsQ.data, 'FISCAL_DOC_CANCEL');

  function applyDiscount(value: number) {
    const v = Math.max(0, value);
    if (v > 0 && !canApplyDiscount) {
      setToast({
        kind: 'err',
        text: 'Sem permissão para desconto. Solicite ao administrador.',
      });
      return;
    }
    setDiscount(v);
  }

  function applySurcharge(value: number) {
    if (serviceTabRef.current) return; // taxas da comanda vêm da empresa
    setSurcharge(Math.max(0, value));
  }

  async function requestFinalizeSale() {
    const creditPays = payments.filter((p) => isCustomerCreditKind(p.method));
    if (creditPays.length) {
      if (!customer?.id) {
        setToast({
          kind: 'err',
          text: 'Informe o cliente para finalizar com crediário ou requisição.',
        });
        setCustomerOpen(true);
        return;
      }
      let cust = customer;
      if (
        cust.creditAvailable == null ||
        cust.requisitionAvailable == null ||
        cust.creditLimit == null ||
        cust.requisitionLimit == null
      ) {
        try {
          const summary = await api<{
            creditLimit: string;
            requisitionLimit: string;
            creditAvailable: string;
            requisitionAvailable: string;
          }>(`/customers/${cust.id}/credit-summary`);
          cust = {
            ...cust,
            creditLimit: summary.creditLimit,
            requisitionLimit: summary.requisitionLimit,
            creditAvailable: summary.creditAvailable,
            requisitionAvailable: summary.requisitionAvailable,
          };
          setCustomer(cust);
        } catch (e) {
          setToast({
            kind: 'err',
            text: e instanceof Error ? e.message : 'Não foi possível consultar o limite do cliente.',
          });
          return;
        }
      }
      const byKind = new Map<string, number>();
      for (const p of creditPays) {
        byKind.set(p.method, Math.round(((byKind.get(p.method) ?? 0) + p.amount) * 100) / 100);
      }
      for (const [method, amount] of byKind) {
        const available =
          method === 'REQUISITION'
            ? Number(cust.requisitionAvailable ?? cust.requisitionLimit ?? NaN)
            : Number(cust.creditAvailable ?? cust.creditLimit ?? NaN);
        const limit =
          method === 'REQUISITION'
            ? Number(cust.requisitionLimit ?? 0)
            : Number(cust.creditLimit ?? 0);
        if (Number.isFinite(available) && amount > available + 0.005) {
          const label = method === 'REQUISITION' ? 'requisição' : 'crédito';
          setToast({
            kind: 'err',
            text:
              `Limite de ${label} insuficiente. Limite: ${formatBRL(limit)}; ` +
              `disponível: ${formatBRL(available)}; valor: ${formatBRL(amount)}.`,
          });
          return;
        }
      }
    }

    const hasItemDiscount = lines.some((l) => l.discount > 0.005);
    if ((discount > 0 || hasItemDiscount) && !isAdmin()) {
      if (!canApplyDiscount) {
        setToast({
          kind: 'err',
          text: 'Sem permissão para desconto (item ou total). Solicite ao administrador.',
        });
        return;
      }
      setPermModalError(null);
      setPermModal({ kind: 'discount_finish' });
      return;
    }
    createSale.mutate(undefined);
  }

  /* --- queries (continuação) --- */

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () =>
      api<
        RestaurantFeesCompany & {
          saleReceiptAutoPrint?: boolean;
          saleReceiptPrinterHint?: string | null;
          pdvDocumentMode?: 'NON_FISCAL_RECEIPT' | 'ELECTRONIC_FISCAL_PLANNED';
          scaleMode?: ScaleMode;
          scaleAutoConfirmMs?: number;
          barcodeWeightPattern?: string | null;
          restaurantModuleEnabled?: boolean;
        }
      >('/company'),
    staleTime: 60_000,
  });

  const restaurantPdv =
    Boolean(companyQ.data?.restaurantModuleEnabled) || hasRestaurantPlan();

  const scaleMode = (companyQ.data?.scaleMode ?? 'MANUAL') as ScaleMode;
  const scale = usePosScale({
    mode: scaleMode === 'BARCODE_LABEL' ? 'MANUAL' : scaleMode,
    autoConfirmMs: companyQ.data?.scaleAutoConfirmMs ?? 700,
    enabled: true,
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

  const customerSearchQ = useQuery({
    queryKey: ['customers', 'search', customerSearch],
    queryFn: () =>
      api<CustomerSearchRow[]>(
        `/customers/search?q=${encodeURIComponent(customerSearch.trim())}`,
      ),
    enabled: customerOpen && customerSearch.trim().length >= 1,
    staleTime: 2_000,
  });

  const search = useQuery({
    queryKey: ['products', 'search', scannerValue],
    queryFn: () => api<ProductSearchRow[]>(`/products/search?q=${encodeURIComponent(scannerValue.trim())}`),
    enabled: suggestOpen && scannerValue.trim().length >= 1,
    staleTime: 0,
  });

  /**
   * Recarrega o saldo de cada item do carrinho direto da API (sem cache).
   * Necessário após inventário/entrada — o `stockTotal` gravado na linha
   * ficava congelado e o PDV continuava avisando "sem estoque".
   */
  const refreshCartStock = useCallback(async () => {
    const snapshot = linesRef.current;
    if (!snapshot.length || serviceTabRef.current) return;
    const unique = [...new Map(snapshot.map((l) => [l.variantId, l])).values()];
    const updates = await Promise.all(
      unique.map(async (l) => {
        const q = (l.barcode || l.sku || l.productName).trim();
        if (!q) return null;
        try {
          const matches = await api<ProductSearchRow[]>(
            `/products/search?q=${encodeURIComponent(q)}`,
          );
          const hit =
            matches.find((m) => m.variantId === l.variantId) ??
            matches.find(
              (m) =>
                (l.barcode && m.barcode === l.barcode) ||
                (l.sku && m.sku === l.sku),
            );
          if (!hit) return null;
          return {
            variantId: l.variantId,
            stockTotal: parseDecimal(hit.stockTotal),
            minStock: parseDecimal(hit.minStock),
          };
        } catch {
          return null;
        }
      }),
    );
    const byId = new Map(
      updates.filter(Boolean).map((u) => [u!.variantId, u!] as const),
    );
    if (!byId.size) return;
    setLines((prev) =>
      prev.map((l) => {
        const u = byId.get(l.variantId);
        return u ? { ...l, stockTotal: u.stockTotal, minStock: u.minStock } : l;
      }),
    );
  }, []);

  const openPaymentMenu = useCallback(async () => {
    if (linesRef.current.length === 0) return;
    await refreshCartStock();
    setPayments([]);
    setPaymentMenuOpen(true);
  }, [refreshCartStock]);

  /**
   * Detalhe da sessão (incluindo o `summary.byMethod` com o esperado para o
   * fechamento). Carregado sob demanda: só fetcha quando o modal de fechar
   * caixa abre, evitando trabalho desnecessário.
   */
  const closeDetailQ = useQuery({
    queryKey: ['cash', 'sessions', session.id, 'detail'],
    queryFn: () =>
      api<{
        summary: {
          byMethod: Record<string, number>;
          totalCompleted: number;
          movementBreakdown?: CashMovementBreakdown;
        };
      }>(`/cash/sessions/${session.id}`),
    enabled: closeOpen,
  });

  /* --- foco automático no scanner --- */

  useEffect(() => {
    scannerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), toast.kind === 'err' ? 6000 : 2400);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    function onPrintFailed(ev: Event) {
      const detail = (ev as CustomEvent<{ error?: string }>).detail;
      const msg = detail?.error?.trim() || 'Falha ao enviar cupom à impressora.';
      setToast({ kind: 'err', text: msg });
    }
    window.addEventListener('gv-print-failed', onPrintFailed);
    return () => window.removeEventListener('gv-print-failed', onPrintFailed);
  }, []);

  /* --- carregar comanda do salão (?comanda=id ou sessionStorage) --- */
  type ServiceTabPayload = {
    id: string;
    number: number;
    status: string;
    guestCount?: number;
    customer?: { id: string; name: string } | null;
    table: { code: string; label: string | null; area: { name: string } } | null;
    station?: { code: string; label: string | null } | null;
    items: Array<{
      status: string;
      quantity: string | number;
      unitPrice: string | number;
      discount?: string | number;
      variant: {
        id: string;
        sku: string;
        barcode: string | null;
        product: { name: string; taxUnit: string | null };
      };
    }>;
  };

  function applyServiceTabToCart(tab: ServiceTabPayload) {
    const tabName = formatServiceTabLabel(tab);
    if (tab.status !== 'OPEN') {
      setToast({ kind: 'err', text: `Comanda ${tabName} não está aberta.` });
      return false;
    }
    const active = tab.items.filter((i) => i.status !== 'CANCELLED');
    if (!active.length) {
      setToast({ kind: 'err', text: `Comanda ${tabName} sem itens.` });
      return false;
    }

    const byVariant = new Map<string, CartLine>();
    for (const it of active) {
      const taxUnit = normalizeTaxUnit(it.variant.product.taxUnit);
      const qty = roundCartQty(Number(it.quantity), taxUnit);
      const unitPrice = Number(it.unitPrice);
      const lineDiscount = Math.max(0, Number(it.discount ?? 0));
      const prev = byVariant.get(it.variant.id);
      if (prev) {
        prev.quantity = roundCartQty(prev.quantity + qty, taxUnit);
        prev.discount = Math.max(0, prev.discount + lineDiscount);
      } else {
        byVariant.set(it.variant.id, {
          variantId: it.variant.id,
          productName: it.variant.product.name,
          sku: it.variant.sku,
          barcode: it.variant.barcode,
          unitPrice,
          quantity: qty,
          discount: lineDiscount,
          stockTotal: 0,
          minStock: 0,
          taxUnit,
          fromComanda: true,
        });
      }
    }

    setLines([...byVariant.values()]);
    setQtyDraft({});
    setDiscount(0);
    setPayments([]);
    setTabCandidates([]);
    if (tab.customer) {
      setCustomer({ id: tab.customer.id, name: tab.customer.name });
    } else {
      setCustomer(null);
    }
    const tableLabel = tab.table
      ? `${tab.table.area.name} / ${tab.table.label || tab.table.code}`
      : 'sem mesa';
    const guests = Math.max(1, Math.floor(Number(tab.guestCount ?? 1)) || 1);
    setServiceTab({
      id: tab.id,
      number: tab.number,
      displayName: tabName,
      label: tableLabel,
      guestCount: guests,
    });
    // Taxas da comanda: calculadas a partir da empresa + pessoas (F9 bloqueado).
    const itemsSub = [...byVariant.values()].reduce(
      (s, l) => s + l.unitPrice * l.quantity - l.discount,
      0,
    );
    const fees = calcRestaurantFees(companyQ.data, itemsSub, guests);
    setSurcharge(fees.feesTotal);
    serviceTabLoadedRef.current = tab.id;
    try {
      sessionStorage.setItem(GV_PDV_COMANDA_KEY, tab.id);
    } catch {
      /* ignore */
    }
    setPaymentMenuOpen(false);
    setToast({
      kind: 'ok',
      text: `Comanda ${tabName} carregada (${tableLabel}). Confira os itens e use F2 para pagar.`,
    });
    return true;
  }

  async function loadServiceTabById(tabId: string) {
    const tab = await api<ServiceTabPayload>(
      `/restaurant/tabs/${encodeURIComponent(tabId)}`,
    );
    applyServiceTabToCart(tab);
  }

  async function lookupServiceTab(raw: string) {
    const q = raw.trim();
    if (!q) return;
    setTabLookupBusy(true);
    setTabCandidates([]);
    try {
      const res = await api<{
        match: string;
        tab: ServiceTabPayload | null;
        candidates: Array<{
          id: string;
          number: number;
          tableLabel: string;
          itemCount: number;
          total: number;
        }>;
      }>(`/restaurant/tabs/lookup?q=${encodeURIComponent(q)}`);
      if (res.tab) {
        applyServiceTabToCart(res.tab);
        setTabLookup('');
        return;
      }
      if (res.candidates?.length) {
        setTabCandidates(res.candidates);
        setToast({
          kind: 'ok',
          text: `Mesa com ${res.candidates.length} comandas abertas — escolha uma.`,
        });
        return;
      }
      setToast({ kind: 'err', text: `Nenhuma comanda encontrada para "${q}".` });
    } catch (e) {
      setToast({
        kind: 'err',
        text: e instanceof Error ? e.message : 'Falha ao buscar comanda',
      });
    } finally {
      setTabLookupBusy(false);
    }
  }

  useEffect(() => {
    let tabId = searchParams.get('comanda')?.trim() || '';
    if (!tabId) {
      try {
        tabId = sessionStorage.getItem(GV_PDV_COMANDA_KEY)?.trim() || '';
      } catch {
        tabId = '';
      }
    }
    if (!tabId) return;
    if (serviceTabLoadedRef.current === tabId) return;

    let cancelled = false;
    (async () => {
      try {
        await loadServiceTabById(tabId);
      } catch (e) {
        if (!cancelled) {
          serviceTabLoadedRef.current = null;
          try {
            sessionStorage.removeItem(GV_PDV_COMANDA_KEY);
          } catch {
            /* ignore */
          }
          setToast({
            kind: 'err',
            text: e instanceof Error ? e.message : 'Falha ao carregar comanda',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /* --- totais derivados --- */

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.unitPrice * l.quantity - (l.discount || 0), 0),
    [lines],
  );
  const restaurantFees = useMemo(() => {
    if (!serviceTab) return null;
    return calcRestaurantFees(companyQ.data, subtotal, serviceTab.guestCount);
  }, [serviceTab, companyQ.data, subtotal]);

  // Comanda: surcharge = taxas (serviço+couvert+garçom); PDV balcão: F9 livre.
  useEffect(() => {
    if (!serviceTab || !restaurantFees) return;
    setSurcharge(restaurantFees.feesTotal);
  }, [serviceTab, restaurantFees]);

  const paymentFormsQ = useQuery({
    queryKey: ['payment-forms', 'active'],
    queryFn: () => api<PaymentForm[]>('/payment-forms?active=1'),
    staleTime: 60_000,
  });
  const paymentFormById = useMemo(() => {
    const m = new Map<string, PaymentForm>();
    for (const f of paymentFormsQ.data ?? []) m.set(f.id, f);
    return m;
  }, [paymentFormsQ.data]);

  /** Taxa de cartão repassada (sobre o valor da mercadoria já lançado em pagamentos CARD). */
  const cardFeeSurcharge = useMemo(() => {
    let sum = 0;
    for (const p of payments) {
      if (p.method !== 'CARD' || !p.paymentFormId) continue;
      const form = paymentFormById.get(p.paymentFormId);
      if (!form?.passAdminFeeToCustomer) continue;
      sum += calcAdminFee(p.amount, form.adminFeePercent, form.adminFeeFixed);
    }
    return Math.round(sum * 100) / 100;
  }, [payments, paymentFormById]);

  const merchandiseTotal = Math.max(0, subtotal - discount + surcharge);
  const total = merchandiseTotal + cardFeeSurcharge;
  const paidSum = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments]);
  /** Restante da mercadoria (pagamentos ainda não incluem o repasse de taxa). */
  const remaining = Math.max(0, merchandiseTotal - paidSum);
  const change = Math.max(0, paidSum - merchandiseTotal);
  const canFinish = lines.length > 0 && merchandiseTotal > 0 && paidSum + 0.02 >= merchandiseTotal;

  const receiptAutoSummary = useMemo(() => {
    const m = getPosAutoPrintMode();
    const c = companyQ.data?.saleReceiptAutoPrint ?? false;
    if (m === 'on') return 'Cupom: auto (esta máquina)';
    if (m === 'off') return 'Cupom: manual (esta máquina)';
    return c ? 'Cupom: auto (empresa)' : 'Cupom: manual (empresa)';
  }, [companyQ.data?.saleReceiptAutoPrint]);

  /* --- mutações --- */

  const createSale = useMutation({
    mutationFn: (permissionPassword?: string) =>
      api<{ id: string; number: number }>('/sales', {
        method: 'POST',
        json: {
          customerId: customer?.id ?? null,
          discount,
          surcharge,
          serviceFeeAmount: restaurantFees?.serviceFee ?? 0,
          couvertAmount: restaurantFees?.couvert ?? 0,
          waiterTipAmount: restaurantFees?.waiterTip ?? 0,
          guestCount: serviceTabRef.current?.guestCount,
          permissionPassword: permissionPassword || undefined,
          source: serviceTabRef.current ? 'RESTAURANT' : undefined,
          deductStock: serviceTabRef.current ? false : undefined,
          externalRef: serviceTabRef.current ? `tab:${serviceTabRef.current.number}` : undefined,
          notes: serviceTabRef.current
            ? `Comanda ${serviceTabRef.current.displayName}`
            : undefined,
          items: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount > 0 ? l.discount : 0,
          })),
          payments: payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            installments:
              p.method === 'CREDIT' ||
              p.method === 'REQUISITION' ||
              p.method === 'CARD'
                ? p.installments
                : 1,
            paymentFormId: p.paymentFormId ?? null,
          })),
        },
      }),
    onSuccess: async (sale) => {
      sessionStorage.removeItem(GV_POS_CHECKOUT_FAILURE_KEY);
      setPermModal(null);
      setPermModalError(null);
      const tabClosing = serviceTabRef.current;
      if (tabClosing) {
        try {
          await api(`/restaurant/tabs/${encodeURIComponent(tabClosing.id)}/close`, {
            method: 'POST',
            json: { saleId: sale.id },
          });
          void qc.invalidateQueries({ queryKey: ['restaurant'] });
          try {
            sessionStorage.removeItem(GV_PDV_COMANDA_KEY);
          } catch {
            /* ignore */
          }
        } catch (e) {
          setToast({
            kind: 'err',
            text:
              `Venda #${sale.number} ok, mas a comanda ${tabClosing.displayName} não fechou: ` +
              (e instanceof Error ? e.message : 'erro'),
          });
        }
      }
      qc.invalidateQueries({ queryKey: ['cash', 'pdv-readiness'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['reports', 'sales-summary'] });
      qc.invalidateQueries({ queryKey: ['card-transactions'] });
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
      setToast({
        kind: 'ok',
        text: tabClosing
          ? `Venda #${sale.number} · comanda ${tabClosing.displayName} fechada ${formatBRL(concluded)}`
          : `Venda #${sale.number} concluída ${formatBRL(concluded)}`,
      });
      scannerRef.current?.focus();
    },
    onError: (e: Error) => {
      try {
        sessionStorage.setItem(GV_POS_CHECKOUT_FAILURE_KEY, JSON.stringify({ message: e.message, at: new Date().toISOString() }));
      } catch {
        /* ignore */
      }
      qc.invalidateQueries({ queryKey: ['cash', 'pdv-readiness'] });
      void qc.invalidateQueries({ queryKey: ['products', 'search'] });
      void refreshCartStock();
      setToast({ kind: 'err', text: e.message });
    },
  });

  const cancelSale = useMutation({
    mutationFn: ({ id, permissionPassword }: { id: string; permissionPassword: string }) =>
      api(`/sales/${id}/cancel`, {
        method: 'POST',
        json: { permissionPassword },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['reports', 'sales-summary'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      setPermModal(null);
      setPermModalError(null);
      setToast({ kind: 'ok', text: 'Venda cancelada. Estoque estornado.' });
    },
    onError: (e: Error) => {
      setPermModalError(e.message);
      setToast({ kind: 'err', text: e.message });
    },
  });

  const cancelFiscalDocMut = useMutation({
    mutationFn: ({ docId, permissionPassword }: { docId: string; permissionPassword: string }) =>
      api(`/fiscal/documents/${encodeURIComponent(docId)}/cancel`, {
        method: 'POST',
        json: {
          permissionPassword,
          xJust: 'Cancelamento solicitado pelo emitente no GestorVend.',
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales', 'today'] });
      qc.invalidateQueries({ queryKey: ['fiscal', 'documents'] });
      setPermModal(null);
      setPermModalError(null);
      setToast({ kind: 'ok', text: 'Documento fiscal cancelado.' });
    },
    onError: (e: Error) => {
      setPermModalError(e.message);
      setToast({ kind: 'err', text: e.message });
    },
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

  /** Libera PDV/caixa quando a pendência foi tratada externamente (gerente/admin). */
  const clearFiscalIntegrationMut = useMutation({
    mutationFn: (saleId: string) =>
      api(`/sales/${encodeURIComponent(saleId)}/fiscal-integration/clear`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales', 'today'] });
      qc.invalidateQueries({ queryKey: ['cash', 'pdv-readiness'] });
      setToast({ kind: 'ok', text: 'Pendência fiscal da venda limpa — PDV pode seguir quando as regras do caixa permitirem.' });
    },
    onError: (e: Error) => setToast({ kind: 'err', text: e.message }),
  });

  const queueFiscalDocumentMut = useMutation({
    mutationFn: ({ saleId, kind }: { saleId: string; kind: 'NFC_E' | 'NF_E' }) =>
      api('/fiscal/documents/queue', { method: 'POST', json: { saleId, kind } }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales', 'today'] });
      qc.invalidateQueries({ queryKey: ['fiscal', 'documents'] });
      setToast({
        kind: 'ok',
        text: `${vars.kind === 'NF_E' ? 'NF-e' : 'NFC-e'} enfileirada (worker processa em até ~1 min).`,
      });
    },
    onError: (e: Error) => setToast({ kind: 'err', text: e.message }),
  });

  const electronicFiscalPlanned =
    companyQ.data?.pdvDocumentMode === 'ELECTRONIC_FISCAL_PLANNED';

  // Soma de todos os valores contados por método -> total declarado.
  const closingTotal = useMemo(
    () => sumDeclaredForClosingBalance(closingByMethod),
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

  const addLineFromProduct = useCallback((p: ProductSearchRow, qtyOverride?: number) => {
    const promo = p.promoPrice ? parseDecimal(p.promoPrice) : 0;
    const retail = parseDecimal(p.retailPrice);
    const unitPrice = promo > 0 && promo < retail ? promo : retail;
    const taxUnit = normalizeTaxUnit(p.taxUnit);
    const fractional = isFractionalTaxUnit(taxUnit);
    const initialQty =
      qtyOverride != null && qtyOverride > 0
        ? roundCartQty(qtyOverride, taxUnit)
        : fractional
          ? 1
          : 1;

    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === p.variantId);
      if (idx >= 0) {
        if (fractional) {
          if (qtyOverride != null && qtyOverride > 0) {
            return prev.map((l, i) =>
              i === idx ? { ...l, quantity: roundCartQty(qtyOverride, l.taxUnit) } : l,
            );
          }
          // Peso/volume: não soma +1 automaticamente — operador ajusta a qty.
          return prev;
        }
        const step = qtyStepForUnit(prev[idx]!.taxUnit);
        return prev.map((l, i) =>
          i === idx
            ? { ...l, quantity: roundCartQty(l.quantity + step, l.taxUnit) }
            : l,
        );
      }
      return [
        ...prev,
        {
          variantId: p.variantId,
          productName: p.productName,
          sku: p.sku,
          barcode: p.barcode,
          unitPrice,
          quantity: initialQty,
          discount: 0,
          stockTotal: parseDecimal(p.stockTotal),
          minStock: parseDecimal(p.minStock),
          taxUnit,
        },
      ];
    });
    setScannerValue('');
    setSuggestOpen(false);
    setSuggestIdx(0);
    if (fractional && (qtyOverride == null || qtyOverride <= 0)) {
      setFocusQtyVariantId(p.variantId);
      setToast({
        kind: 'ok',
        text: `Informe o peso/quantidade em ${qtyUnitLabel(taxUnit)}`,
      });
    }
  }, []);

  useEffect(() => {
    if (!focusQtyVariantId) return;
    const el = qtyInputRefs.current[focusQtyVariantId];
    if (el) {
      el.focus();
      el.select();
    }
    setFocusQtyVariantId(null);
  }, [focusQtyVariantId, lines]);

  function updateLineQty(variantId: string, qty: number) {
    const line = lines.find((l) => l.variantId === variantId);
    const rounded = roundCartQty(qty, line?.taxUnit);
    if (rounded <= 0) {
      setLines((prev) => prev.filter((l) => l.variantId !== variantId));
      setQtyDraft((d) => {
        const next = { ...d };
        delete next[variantId];
        return next;
      });
      return;
    }
    setLines((prev) =>
      prev.map((l) =>
        l.variantId === variantId ? { ...l, quantity: roundCartQty(qty, l.taxUnit) } : l,
      ),
    );
    setQtyDraft((d) => {
      if (d[variantId] === undefined) return d;
      const next = { ...d };
      delete next[variantId];
      return next;
    });
  }

  function commitQtyDraft(variantId: string) {
    const raw = qtyDraft[variantId];
    if (raw === undefined) return;
    const n = parseDecimal(raw);
    updateLineQty(variantId, n);
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
    setQtyDraft((d) => {
      const next = { ...d };
      delete next[variantId];
      return next;
    });
  }

  function resetSale() {
    setLines([]);
    setQtyDraft({});
    setDiscount(0);
    setSurcharge(0);
    setCustomer(null);
    setPayments([]);
    setScannerValue('');
    setSuggestOpen(false);
    setServiceTab(null);
    setTabCandidates([]);
    setTabLookup('');
    serviceTabLoadedRef.current = null;
    try {
      sessionStorage.removeItem(GV_PDV_COMANDA_KEY);
    } catch {
      /* ignore */
    }
    if (searchParams.get('comanda')) {
      const next = new URLSearchParams(searchParams);
      next.delete('comanda');
      setSearchParams(next, { replace: true });
    }
  }

  function closeCustomerDialog() {
    setCustomerOpen(false);
    setCustomerSearch('');
    setCustomerSearchIdx(0);
  }

  function openCustomerDialog() {
    setCustomerSearch('');
    setCustomerSearchIdx(0);
    setCustomerOpen(true);
  }

  function selectCustomer(c: Customer | null) {
    setCustomer(c);
    closeCustomerDialog();
  }

  function selectCustomerFromSearch(c: CustomerSearchRow) {
    selectCustomer({
      id: c.id,
      name: c.name,
      creditLimit: c.creditLimit,
      requisitionLimit: c.requisitionLimit,
      creditAvailable: c.creditAvailable,
      requisitionAvailable: c.requisitionAvailable,
    });
  }

  function handleCustomerSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const results = customerSearchQ.data ?? [];
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[customerSearchIdx];
      if (picked) selectCustomerFromSearch(picked);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCustomerSearchIdx((i) => Math.min(Math.max(results.length - 1, 0), i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCustomerSearchIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCustomerDialog();
    }
  }

  useEffect(() => {
    if (!customerOpen) return;
    const t = window.setTimeout(() => customerSearchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [customerOpen]);

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
      const weightParsed =
        scaleMode === 'BARCODE_LABEL' || code.startsWith('2')
          ? parseBarcodeWeight(code, companyQ.data?.barcodeWeightPattern ?? undefined)
          : null;
      const searchCode = weightParsed?.plu ?? code;
      const matches = await api<ProductSearchRow[]>(
        `/products/search?q=${encodeURIComponent(searchCode)}`,
      );
      const exact =
        matches.find(
          (m) =>
            m.barcode === code ||
            m.barcode === searchCode ||
            m.sku === searchCode ||
            (m.productControlNumber != null && String(m.productControlNumber) === searchCode),
        ) ?? matches[0];
      if (exact) {
        const qtyFromScale =
          weightParsed?.weightKg ??
          (isFractionalTaxUnit(exact.taxUnit) && scale.weightKg != null && scale.stable
            ? scale.weightKg
            : undefined);
        addLineFromProduct(exact, qtyFromScale);
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
      if (
        customerOpen ||
        historyOpen ||
        closeOpen ||
        paymentMenuOpen ||
        proceduresOpen ||
        itemDiscountDraft
      )
        return;
      if (ev.key === 'F2') {
        ev.preventDefault();
        if (lines.length > 0 && total > 0) {
          // F2 agora abre o submenu de pagamento (fluxo de caixa real:
          // 1º bipa produtos, 2º aperta F2, 3º escolhe forma de pagamento).
          void openPaymentMenu();
        }
      } else if (ev.key === 'F3') {
        ev.preventDefault();
        setProceduresOpen(true);
      } else if (ev.key === 'F4') {
        if (serviceTab) return; // conferência: cliente só após ir ao pagamento
        ev.preventDefault();
        openCustomerDialog();
      } else if (ev.key === 'F8') {
        ev.preventDefault();
        const v = prompt('Desconto em R$ no total da venda', String(discount));
        if (v != null) applyDiscount(parseDecimal(v));
      } else if (ev.key === 'F9') {
        ev.preventDefault();
        if (serviceTab) return; // taxas da comanda não editáveis no PDV
        const v = prompt('Acréscimo em R$ no total da venda', String(surcharge));
        if (v != null) applySurcharge(parseDecimal(v));
      } else if (ev.key === 'Escape' && lines.length > 0) {
        if (serviceTab) return; // use "Cancelar cobrança" no aviso amarelo
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
    surcharge,
    historyOpen,
    closeOpen,
    lines.length,
    total,
    paymentMenuOpen,
    proceduresOpen,
    itemDiscountDraft,
    serviceTab,
    openPaymentMenu,
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
        onOpenProcedures={() => setProceduresOpen(true)}
        onExit={tryExit}
        onCloseCash={() => {
          setCloseOpen(true);
          setClosingByMethod({
            CASH: '',
            CARD: '',
            PIX: '',
            CREDIT: '',
            REQUISITION: '',
            OTHER: '',
            EXPENSE: '',
          });
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

      {serviceTab && (
        <div className="pos-receipt-prompt no-print" role="status" style={{ background: '#fef3c7' }}>
          <span>
            Conferência da <strong>comanda {serviceTab.displayName}</strong>
            {serviceTab.label ? ` · ${serviceTab.label}` : ''} — revise os itens abaixo.
            Depois <strong>F2</strong> (ou o botão) para pagar; a mesa fecha ao concluir.
          </span>
          <div className="pos-receipt-prompt-actions">
            <button
              type="button"
              className="pos-btn pos-btn-finish"
              disabled={lines.length === 0}
              onClick={() => void openPaymentMenu()}
            >
              Ir para pagamento (F2)
            </button>
            <button
              type="button"
              className="pos-btn pos-btn-ghost"
              onClick={() => {
                if (confirm('Desistir desta comanda no PDV? Os itens da comanda no salão permanecem abertos.')) {
                  resetSale();
                }
              }}
            >
              Cancelar cobrança
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
                placeholder="Bipar código, EAN, SKU ou pesquisar por nome…"
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
              <span className="pos-scanner-hint" title={scale.lastError ?? scale.mode}>
                · Balança: {scaleMode === 'MANUAL' ? 'manual' : scale.status}
                {scale.weightKg != null ? ` ${scale.weightKg.toFixed(3)}kg` : ''}
              </span>
              {scaleMode === 'SERIAL_DIRECT' ? (
                <button
                  type="button"
                  className="pos-btn pos-btn-ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    void scale.connectSerial();
                  }}
                >
                  Conectar
                </button>
              ) : null}

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
                            Cód. {p.productControlNumber ?? '—'} · SKU {p.sku}
                            {p.barcode ? ` · EAN ${p.barcode}` : ''}
                            {isFractionalTaxUnit(p.taxUnit)
                              ? ` · ${qtyUnitLabel(p.taxUnit)}`
                              : ''}
                          </div>
                        </div>
                        <div>
                          <div className="pos-suggest-price">
                            {formatBRL(p.retailPrice)}
                            {isFractionalTaxUnit(p.taxUnit)
                              ? `/${qtyUnitLabel(p.taxUnit)}`
                              : ''}
                          </div>
                          <div className={`pos-suggest-stock pos-stock-pill ${pillClass}`}>
                            {stock <= 0
                              ? 'Sem estoque'
                              : `Em estoque: ${formatCartQty(stock, p.taxUnit)}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {restaurantPdv && (
              <div className="pos-card" style={{ marginBottom: '0.65rem' }}>
                <div className="pos-card-header">
                  <h3 className="pos-card-title">Comanda / mesa</h3>
                </div>
                <div className="pos-card-body" style={{ paddingTop: '0.55rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      className="pos-scanner-input"
                      style={{ flex: '1 1 10rem', minWidth: 0 }}
                      value={tabLookup}
                      onChange={(e) => setTabLookup(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void lookupServiceTab(tabLookup);
                        }
                      }}
                      placeholder="Nº da comanda ou código da mesa"
                      inputMode="numeric"
                      disabled={tabLookupBusy}
                    />
                    <button
                      type="button"
                      className="pos-btn pos-btn-finish"
                      style={{ minHeight: 44 }}
                      disabled={tabLookupBusy || !tabLookup.trim()}
                      onClick={() => void lookupServiceTab(tabLookup)}
                    >
                      {tabLookupBusy ? 'Buscando…' : 'Carregar'}
                    </button>
                  </div>
                  <p className="pos-scanner-hint" style={{ marginTop: '0.4rem' }}>
                    Ex.: comanda <strong>12</strong> ou mesa <strong>01</strong> — Enter carrega para F2.
                  </p>
                  {tabCandidates.length > 0 && (
                    <ul style={{ listStyle: 'none', margin: '0.5rem 0 0', padding: 0 }}>
                      {tabCandidates.map((c) => (
                        <li key={c.id} style={{ marginBottom: '0.35rem' }}>
                          <button
                            type="button"
                            className="pos-btn pos-btn-ghost"
                            style={{ width: '100%', justifyContent: 'space-between' }}
                            onClick={() => void loadServiceTabById(c.id)}
                          >
                            <span>
                              Comanda #{c.number} · {c.tableLabel} · {c.itemCount} itens
                            </span>
                            <strong>
                              {c.total.toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </strong>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

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
                          const status = l.fromComanda
                            ? 'ok'
                            : classifyStock(l.stockTotal, l.quantity, l.minStock);
                          const rowClass =
                            status === 'out' ? 'is-out' : status === 'low' ? 'is-low' : '';
                          const step = qtyStepForUnit(l.taxUnit);
                          const unitLbl = qtyUnitLabel(l.taxUnit);
                          const fractional = isFractionalTaxUnit(l.taxUnit);
                          const qtyDisplay =
                            qtyDraft[l.variantId] !== undefined
                              ? qtyDraft[l.variantId]!
                              : formatCartQty(l.quantity, l.taxUnit);
                          return (
                            <tr key={l.variantId} className={rowClass}>
                              <td>
                                <div className="pos-item-name">{l.productName}</div>
                                <span className="pos-item-sku">
                                  SKU {l.sku}
                                  {l.barcode ? ` · EAN ${l.barcode}` : ''}
                                  {fractional ? ` · ${unitLbl}` : ''}
                                </span>
                              </td>
                              <td>
                                <div className="pos-qty-group">
                                  <button
                                    type="button"
                                    className="pos-qty-btn"
                                    onClick={() =>
                                      updateLineQty(
                                        l.variantId,
                                        roundCartQty(l.quantity - step, l.taxUnit),
                                      )
                                    }
                                    aria-label={`Diminuir quantidade (${unitLbl})`}
                                  >
                                    −
                                  </button>
                                  <input
                                    ref={(el) => {
                                      qtyInputRefs.current[l.variantId] = el;
                                    }}
                                    className={`pos-qty-input${fractional ? ' pos-qty-input--frac' : ''}`}
                                    inputMode="decimal"
                                    value={qtyDisplay}
                                    aria-label={`Quantidade em ${unitLbl}`}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      // Permite digitação intermediária (vírgula/ponto)
                                      if (raw === '' || /^[\d.,]*$/.test(raw)) {
                                        setQtyDraft((d) => ({ ...d, [l.variantId]: raw }));
                                        const n = parseDecimal(raw);
                                        if (raw !== '' && raw !== ',' && raw !== '.' && n > 0) {
                                          setLines((prev) =>
                                            prev.map((row) =>
                                              row.variantId === l.variantId
                                                ? {
                                                    ...row,
                                                    quantity: roundCartQty(n, row.taxUnit),
                                                  }
                                                : row,
                                            ),
                                          );
                                        }
                                      }
                                    }}
                                    onBlur={() => commitQtyDraft(l.variantId)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        commitQtyDraft(l.variantId);
                                        scannerRef.current?.focus();
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="pos-qty-btn"
                                    onClick={() =>
                                      updateLineQty(
                                        l.variantId,
                                        roundCartQty(l.quantity + step, l.taxUnit),
                                      )
                                    }
                                    aria-label={`Aumentar quantidade (${unitLbl})`}
                                  >
                                    +
                                  </button>
                                  {fractional && scale.weightKg != null ? (
                                    <button
                                      type="button"
                                      className="pos-qty-btn"
                                      title="Usar peso da balança"
                                      onClick={() => updateLineQty(l.variantId, scale.weightKg!)}
                                    >
                                      ⚖
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <span className={`pos-stock-pill ${status}`}>
                                  {l.fromComanda
                                    ? 'Comanda'
                                    : status === 'out'
                                      ? 'Sem estoque'
                                      : status === 'low'
                                        ? `Baixo (${formatCartQty(l.stockTotal, l.taxUnit)} ${unitLbl})`
                                        : `OK (${formatCartQty(l.stockTotal, l.taxUnit)} ${unitLbl})`}
                                </span>
                              </td>
                              <td>
                                <div className="pos-line-money">
                                  {l.discount > 0.005 ? (
                                    <>
                                      <span
                                        style={{
                                          textDecoration: 'line-through',
                                          opacity: 0.65,
                                          fontSize: '0.85em',
                                          display: 'block',
                                        }}
                                      >
                                        {formatBRL(l.unitPrice * l.quantity)}
                                      </span>
                                      {formatBRL(l.unitPrice * l.quantity - l.discount)}
                                    </>
                                  ) : (
                                    formatBRL(l.unitPrice * l.quantity)
                                  )}
                                </div>
                                <span className="pos-line-unit">
                                  {formatBRL(l.unitPrice)}/{unitLbl}
                                  {l.discount > 0.005
                                    ? ` · −${formatBRL(l.discount)}`
                                    : ''}
                                </span>
                                {canApplyDiscount ? (
                                  <button
                                    type="button"
                                    className="pos-btn pos-btn-ghost"
                                    style={{
                                      fontSize: '0.72rem',
                                      padding: '0.15rem 0.4rem',
                                      marginTop: 4,
                                    }}
                                    title="Desconto neste item (R$ ou %)"
                                    onClick={() =>
                                      setItemDiscountDraft({
                                        variantId: l.variantId,
                                        mode: 'BRL',
                                        value: l.discount > 0 ? String(l.discount) : '',
                                      })
                                    }
                                  >
                                    Desc. item
                                  </button>
                                ) : null}
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
                    <span>
                      Desconto <span className="pos-shortcut-key">F8</span>
                    </span>
                    <div className="pos-discount-row" style={{ width: 160 }}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={discount || ''}
                        placeholder="0,00"
                        onChange={(e) => applyDiscount(parseDecimal(e.target.value))}
                        disabled={!canApplyDiscount}
                        title={
                          canApplyDiscount
                            ? 'Desconto comercial no total (− vDesc)'
                            : 'Sem permissão para desconto — solicite ao administrador'
                        }
                      />
                    </div>
                  </div>
                  {serviceTab && restaurantFees ? (
                    <>
                      {restaurantFees.serviceFee > 0.005 ? (
                        <div className="pos-totals-row">
                          <span>Taxa de serviço</span>
                          <strong>{formatBRL(restaurantFees.serviceFee)}</strong>
                        </div>
                      ) : null}
                      {restaurantFees.couvert > 0.005 ? (
                        <div className="pos-totals-row">
                          <span>
                            Couvert
                            {serviceTab.guestCount > 1
                              ? ` (${serviceTab.guestCount} pessoas)`
                              : ''}
                          </span>
                          <strong>{formatBRL(restaurantFees.couvert)}</strong>
                        </div>
                      ) : null}
                      {restaurantFees.waiterTip > 0.005 ? (
                        <div className="pos-totals-row">
                          <span>Taxa do garçom</span>
                          <strong>{formatBRL(restaurantFees.waiterTip)}</strong>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="pos-totals-row">
                      <span>
                        Acréscimo <span className="pos-shortcut-key">F9</span>
                      </span>
                      <div className="pos-discount-row" style={{ width: 160 }}>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={surcharge || ''}
                          placeholder="0,00"
                          onChange={(e) => applySurcharge(parseDecimal(e.target.value))}
                          title="Outras despesas / acréscimo no total (+ vOutro)"
                        />
                      </div>
                    </div>
                  )}
                  {cardFeeSurcharge > 0.005 ? (
                    <div className="pos-totals-row">
                      <span>Taxa cartão (repasse)</span>
                      <strong>{formatBRL(cardFeeSurcharge)}</strong>
                    </div>
                  ) : null}
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
          <div
            className={
              serviceTab && !paymentMenuOpen
                ? 'pos-right pos-right--conference'
                : 'pos-right'
            }
          >
            {serviceTab && !paymentMenuOpen ? (
              <div className="pos-right-conference-veil" aria-live="polite">
                <p>
                  Conferência da comanda — revise os itens à esquerda.
                  <br />
                  Use <strong>Ir para pagamento</strong> no aviso amarelo ou{' '}
                  <span className="pos-shortcut-key">F2</span>.
                </p>
              </div>
            ) : null}
            <div
              className="pos-right-inner"
              aria-hidden={Boolean(serviceTab && !paymentMenuOpen)}
            >
              <button
                type="button"
                className="pos-customer-btn"
                onClick={openCustomerDialog}
                title="Selecionar cliente (F4)"
                tabIndex={serviceTab && !paymentMenuOpen ? -1 : undefined}
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

              <div className="pos-mobile-sheet-totals" aria-hidden="true">
                <div className="pos-totals-row">
                  <span>Subtotal</span>
                  <strong>{formatBRL(subtotal)}</strong>
                </div>
                {discount > 0.005 ? (
                  <div className="pos-totals-row">
                    <span>Desconto</span>
                    <strong>− {formatBRL(discount)}</strong>
                  </div>
                ) : null}
                <div className="pos-totals-row pos-mobile-sheet-total">
                  <span>Total</span>
                  <strong>{formatBRL(total)}</strong>
                </div>
              </div>

              <button
                type="button"
                className="pos-btn pos-btn-finish"
                onClick={() => {
                  if (lines.length === 0 || total <= 0) return;
                  void openPaymentMenu();
                }}
                disabled={
                  lines.length === 0 ||
                  total <= 0 ||
                  createSale.isPending ||
                  Boolean(serviceTab && !paymentMenuOpen)
                }
                title="Finalizar venda (F2)"
                tabIndex={serviceTab && !paymentMenuOpen ? -1 : undefined}
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
                disabled={lines.length === 0 || Boolean(serviceTab && !paymentMenuOpen)}
                tabIndex={serviceTab && !paymentMenuOpen ? -1 : undefined}
              >
                Cancelar venda
                <span className="pos-shortcut-key">Esc</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- DIALOG: cliente ---------- */}
      {customerOpen && (
        <FormModalBackdrop onClose={closeCustomerDialog}>
          <div
            className="modal pos-customer-modal"
            role="dialog"
            aria-label="Pesquisar cliente"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Cliente da venda</h2>
            <p className="pos-customer-modal-hint">
              Pesquise por nome, CPF/CNPJ ou telefone. Use{' '}
              <span className="pos-shortcut-key">↑</span>{' '}
              <span className="pos-shortcut-key">↓</span> e{' '}
              <span className="pos-shortcut-key">Enter</span>.
            </p>

            <button
              type="button"
              className="pos-customer-item pos-customer-item--balcao"
              onClick={() => selectCustomer(null)}
            >
              <strong>Balcão (sem cliente)</strong>
              <span className="pos-customer-item-meta">venda anônima</span>
            </button>

            <div className="pos-customer-search-wrap">
              <span className="pos-customer-search-icon" aria-hidden>
                🔍
              </span>
              <input
                ref={customerSearchRef}
                type="search"
                className="pos-customer-search-input"
                placeholder="Digite para pesquisar…"
                value={customerSearch}
                autoComplete="off"
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setCustomerSearchIdx(0);
                }}
                onKeyDown={handleCustomerSearchKeyDown}
              />
            </div>

            <div className="pos-customer-list" role="listbox">
              {customerSearch.trim().length < 1 ? (
                <div className="pos-items-empty">
                  Digite ao menos 1 caractere para buscar clientes.
                </div>
              ) : customerSearchQ.isLoading ? (
                <div className="pos-items-empty">Pesquisando…</div>
              ) : customerSearchQ.data && customerSearchQ.data.length > 0 ? (
                customerSearchQ.data.map((c, i) => (
                  <div
                    key={c.id}
                    role="option"
                    aria-selected={i === customerSearchIdx}
                    className={
                      'pos-customer-item' +
                      (i === customerSearchIdx ? ' is-active' : '') +
                      (customer?.id === c.id ? ' is-selected' : '')
                    }
                    onMouseEnter={() => setCustomerSearchIdx(i)}
                    onClick={() => selectCustomerFromSearch(c)}
                  >
                    <div>
                      <strong>{c.name}</strong>
                      {(c.document || c.phone) && (
                        <span className="pos-customer-item-meta">
                          {[c.document, c.phone].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                    {customer?.id === c.id && (
                      <span className="pos-stock-pill ok">Atual</span>
                    )}
                  </div>
                ))
              ) : (
                <div className="pos-items-empty">
                  Nenhum cliente para “{customerSearch.trim()}”.
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="pos-btn pos-btn-ghost"
                onClick={closeCustomerDialog}
              >
                Fechar
                <span className="pos-shortcut-key">Esc</span>
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {/* ---------- DIALOG: fechar caixa ---------- */}
      {closeOpen && (
        <FormModalBackdrop onClose={() => setCloseOpen(false)}>
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
                const openingNum = parseDecimal(session.openingBalance);
                const expectedBase = closeDetailQ.data?.summary.byMethod[m.key] ?? 0;
                const breakdown = closeDetailQ.data?.summary.movementBreakdown;
                const expectedDisplay =
                  m.key === 'CASH'
                    ? expectedFinalForReconKey('CASH', closeDetailQ.data?.summary.byMethod ?? {}, openingNum)
                    : expectedBase;
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
                          {m.key === 'CASH' ? (
                            <>
                              {' '}
                              ({formatCashExpectedHint(openingNum, breakdown)})
                            </>
                          ) : m.key === 'EXPENSE' ? (
                            ' (despesas lançadas · analítico)'
                          ) : (
                            ''
                          )}
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
              <span>Total apresentado (meios)</span>
              <strong>{formatBRL(closingTotal)}</strong>
            </div>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--pos-text-sub)' }}>
              Despesas informadas acima são conferência analítica e não entram neste total.
            </p>

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
        </FormModalBackdrop>
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
                      {Boolean(s.fiscalIntegrationError?.trim()) && (
                        <div className="pos-fiscal-banner pos-fiscal-banner--error" role="alert">
                          <strong>Integração fiscal:</strong>{' '}
                          <span className="pos-fiscal-banner-msg">{s.fiscalIntegrationError!.trim()}</span>
                          {canManagePastSales && (
                            <button
                              type="button"
                              className="pos-btn pos-btn-ghost pos-fiscal-banner-action"
                              disabled={clearFiscalIntegrationMut.isPending}
                              title="Use após corrigir a NF ou registrar a tratativa conforme política da loja."
                              onClick={() => {
                                if (
                                  confirm(
                                    `Limpar o erro fiscal da venda #${s.number}?\n\n` +
                                      `Só faça isso depois de resolver a pendência na SEFAZ ou por processo manual acordado. ` +
                                      `O operador poderá voltar a abrir caixa / PDV.`,
                                  )
                                ) {
                                  clearFiscalIntegrationMut.mutate(s.id);
                                }
                              }}
                            >
                              {clearFiscalIntegrationMut.isPending ? 'Liberando…' : 'Liberar PDV'}
                            </button>
                          )}
                        </div>
                      )}
                      {s.status === 'COMPLETED' && s.fiscalDocument && (
                        <div className="pos-fiscal-doc-line">
                          <span className="pos-fiscal-doc-label">DFe</span>{' '}
                          {fiscalDocumentKindPt(s.fiscalDocument.kind)} ·{' '}
                          <strong>{fiscalDocumentStatusPt(s.fiscalDocument.status)}</strong>
                          {s.fiscalDocument.accessKey?.trim() ? (
                            <span className="pos-fiscal-doc-key">
                              {' '}
                              · chave {s.fiscalDocument.accessKey.trim().slice(0, 12)}…
                            </span>
                          ) : null}
                          {s.fiscalDocument.lastError?.trim() ? (
                            <span className="pos-fiscal-doc-err">
                              {' '}
                              ({s.fiscalDocument.lastError.trim()})
                            </span>
                          ) : null}
                        </div>
                      )}
                      {s.status === 'COMPLETED' && electronicFiscalPlanned && !s.fiscalDocument && (
                        <p className="pos-fiscal-hint-muted">
                          Modo fiscal planejado: ainda não há registro na fila de emissão para esta venda.
                        </p>
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
                          {s.status === 'COMPLETED' &&
                            electronicFiscalPlanned &&
                            canManagePastSales && (
                              <>
                                <button
                                  type="button"
                                  className="pos-btn pos-btn-ghost pos-history-action-warn"
                                  disabled={queueFiscalDocumentMut.isPending}
                                  title="Enfileira NFC-e (modelo 65) para transmissão à SEFAZ."
                                  onClick={() =>
                                    queueFiscalDocumentMut.mutate({ saleId: s.id, kind: 'NFC_E' })
                                  }
                                >
                                  {queueFiscalDocumentMut.isPending
                                    ? 'Enfileirando…'
                                    : s.fiscalDocument?.kind === 'NFC_E'
                                      ? 'Reenfileirar NFC-e'
                                      : 'Enfileirar NFC-e'}
                                </button>
                                <button
                                  type="button"
                                  className="pos-btn pos-btn-ghost pos-history-action-warn"
                                  disabled={queueFiscalDocumentMut.isPending}
                                  title="Enfileira NF-e (modelo 55). Exige cliente com CPF/CNPJ."
                                  onClick={() =>
                                    queueFiscalDocumentMut.mutate({ saleId: s.id, kind: 'NF_E' })
                                  }
                                >
                                  {queueFiscalDocumentMut.isPending
                                    ? 'Enfileirando…'
                                    : s.fiscalDocument?.kind === 'NF_E'
                                      ? 'Reenfileirar NF-e'
                                      : 'Enfileirar NF-e'}
                                </button>
                              </>
                            )}
                          {s.status === 'COMPLETED' && canCancelSale && (
                            <>
                              {rows.length >= 2 && canManagePastSales && (
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
                                    if (isAdmin()) {
                                      cancelSale.mutate({ id: s.id, permissionPassword: '' });
                                    } else {
                                      setPermModalError(null);
                                      setPermModal({
                                        kind: 'cancel_sale',
                                        saleId: s.id,
                                        saleNumber: s.number,
                                      });
                                    }
                                  }
                                }}
                              >
                                Cancelar venda inteira
                              </button>
                              {s.fiscalDocument &&
                                s.fiscalDocument.status !== 'CANCELLED' &&
                                canCancelFiscalDoc && (
                                  <button
                                    type="button"
                                    className="pos-btn pos-btn-ghost pos-history-action-danger"
                                    disabled={cancelFiscalDocMut.isPending}
                                    onClick={() => {
                                      if (
                                        confirm(
                                          `Cancelar o documento fiscal da venda #${s.number}?\n\n` +
                                            `O registro local será marcado como cancelado.`,
                                        )
                                      ) {
                                        if (isAdmin()) {
                                          cancelFiscalDocMut.mutate({
                                            docId: s.fiscalDocument!.id,
                                            permissionPassword: '',
                                          });
                                        } else {
                                          setPermModalError(null);
                                          setPermModal({
                                            kind: 'fiscal_cancel',
                                            docId: s.fiscalDocument!.id,
                                            saleNumber: s.number,
                                          });
                                        }
                                      }
                                    }}
                                  >
                                    Cancelar nota fiscal
                                  </button>
                                )}
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
        <FormModalBackdrop
          onClose={() => setSaleLineRemoveDraft(null)}
          style={{ zIndex: 70 }}
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
        </FormModalBackdrop>
      )}

      {paymentMenuOpen && (
        <PaymentOverlay
          total={total}
          merchandiseTotal={merchandiseTotal}
          cardFeeSurcharge={cardFeeSurcharge}
          subtotal={subtotal}
          discount={discount}
          surcharge={surcharge}
          feeBreakdown={restaurantFees}
          guestCount={serviceTab?.guestCount}
          itemsCount={lines.length}
          customerName={customer?.name ?? null}
          payments={payments}
          remaining={remaining}
          change={change}
          isFinishing={createSale.isPending}
          onAddPayment={(p) => setPayments((prev) => [...prev, p])}
          onRemovePayment={(id) => setPayments((prev) => prev.filter((x) => x.id !== id))}
          onCancel={() => setPaymentMenuOpen(false)}
          onConfirm={() => requestFinalizeSale()}
        />
      )}

      <PdvProceduresOverlay
        open={proceduresOpen}
        onClose={() => setProceduresOpen(false)}
        onSuccess={(msg) => setToast({ kind: 'ok', text: msg })}
      />

      {itemDiscountDraft &&
        (() => {
          const line = lines.find((l) => l.variantId === itemDiscountDraft.variantId);
          if (!line) return null;
          const gross = Math.round(line.unitPrice * line.quantity * 100) / 100;
          return (
            <FormModalBackdrop onClose={() => setItemDiscountDraft(null)}>
              <div
                className="modal"
                role="dialog"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: 400 }}
              >
                <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Desconto no item</h2>
                <p style={{ marginTop: 0, color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
                  <strong>{line.productName}</strong>
                  <br />
                  Valor bruto da linha: {formatBRL(gross)}
                </p>
                <div className="form-row">
                  <div className="field" style={{ flex: '0 0 110px' }}>
                    <label>Tipo</label>
                    <select
                      value={itemDiscountDraft.mode}
                      onChange={(e) =>
                        setItemDiscountDraft((d) =>
                          d ? { ...d, mode: e.target.value as 'BRL' | 'PCT' } : d,
                        )
                      }
                    >
                      <option value="BRL">R$</option>
                      <option value="PCT">%</option>
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Valor</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      autoFocus
                      value={itemDiscountDraft.value}
                      onChange={(e) =>
                        setItemDiscountDraft((d) => (d ? { ...d, value: e.target.value } : d))
                      }
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        const raw = parseDecimal(itemDiscountDraft.value);
                        let disc =
                          itemDiscountDraft.mode === 'PCT'
                            ? Math.round(((gross * raw) / 100) * 100) / 100
                            : raw;
                        disc = Math.max(0, Math.min(gross, disc));
                        if (disc > 0 && !canApplyDiscount) {
                          setToast({
                            kind: 'err',
                            text: 'Sem permissão para desconto. Solicite ao administrador.',
                          });
                          return;
                        }
                        setLines((prev) =>
                          prev.map((l) =>
                            l.variantId === line.variantId ? { ...l, discount: disc } : l,
                          ),
                        );
                        setItemDiscountDraft(null);
                      }}
                    />
                  </div>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setLines((prev) =>
                        prev.map((l) =>
                          l.variantId === line.variantId ? { ...l, discount: 0 } : l,
                        ),
                      );
                      setItemDiscountDraft(null);
                    }}
                  >
                    Zerar
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setItemDiscountDraft(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      const raw = parseDecimal(itemDiscountDraft.value);
                      let disc =
                        itemDiscountDraft.mode === 'PCT'
                          ? Math.round(((gross * raw) / 100) * 100) / 100
                          : raw;
                      disc = Math.max(0, Math.min(gross, disc));
                      if (disc > 0 && !canApplyDiscount) {
                        setToast({
                          kind: 'err',
                          text: 'Sem permissão para desconto. Solicite ao administrador.',
                        });
                        return;
                      }
                      setLines((prev) =>
                        prev.map((l) =>
                          l.variantId === line.variantId ? { ...l, discount: disc } : l,
                        ),
                      );
                      setItemDiscountDraft(null);
                    }}
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            </FormModalBackdrop>
          );
        })()}

      <PermissionPasswordModal
        open={permModal != null}
        title={
          permModal?.kind === 'discount_finish'
            ? 'Autorizar desconto'
            : permModal?.kind === 'cancel_sale'
              ? 'Autorizar cancelamento de venda'
              : 'Autorizar cancelamento fiscal'
        }
        description={
          permModal?.kind === 'discount_finish'
            ? `Informe a senha de autorização para concluir a venda com desconto${
                discount > 0 ? ` de ${formatBRL(discount)} no total` : ''
              }${
                lines.some((l) => l.discount > 0.005) ? ' (inclui desconto em item)' : ''
              }.`
            : permModal?.kind === 'cancel_sale'
              ? `Informe a senha de autorização para cancelar a venda #${permModal.saleNumber}.`
              : permModal?.kind === 'fiscal_cancel'
                ? `Informe a senha de autorização para cancelar a nota fiscal da venda #${permModal.saleNumber}.`
                : ''
        }
        busy={createSale.isPending || cancelSale.isPending || cancelFiscalDocMut.isPending}
        error={permModalError}
        onClose={() => {
          setPermModal(null);
          setPermModalError(null);
        }}
        onConfirm={(password) => {
          if (!permModal) return;
          if (permModal.kind === 'discount_finish') {
            createSale.mutate(password, {
              onError: (e: Error) => setPermModalError(e.message),
            });
            return;
          }
          if (permModal.kind === 'cancel_sale') {
            cancelSale.mutate({ id: permModal.saleId, permissionPassword: password });
            return;
          }
          cancelFiscalDocMut.mutate({ docId: permModal.docId, permissionPassword: password });
        }}
      />

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
  const desktop = isGestorVendDesktop();
  useEffect(() => {
    if (open) setMode(getPosAutoPrintMode());
  }, [open]);

  if (!open) return null;

  return (
    <FormModalBackdrop onClose={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 480 }}
      >
        <h2 style={{ marginTop: 0 }}>Impressão do cupom nesta máquina</h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.86rem', color: 'var(--pos-text-sub)' }}>
          {desktop ? (
            <>
              No <strong>GestorVend Desktop</strong>, configure a impressora térmica 80 mm em{' '}
              <strong>Configurações → Impressão</strong> (painel azul). Cupons e NFC-e saem em
              silêncio nessa impressora.
            </>
          ) : (
            <>
              Com o sistema na nuvem no navegador, o cupom sai pelo diálogo Imprimir deste
              computador. Para escolher a impressora sem diálogo, use o app Desktop.
            </>
          )}
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
    </FormModalBackdrop>
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
  onOpenProcedures,
  onExit,
  onCloseCash,
}: {
  session: CashSession;
  operator: Operator | null;
  salesToday: number;
  receiptAutoSummary: string;
  onOpenPrintPrefs: () => void;
  onOpenHistory: () => void;
  onOpenProcedures: () => void;
  onExit: () => void;
  onCloseCash: () => void;
}) {
  const company = useCompanyBranding();
  const storeName = companyDisplayName(company.data);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="pos-topbar">
      <div className="pos-topbar-brand">
        <CompanyLogo
          className="pos-topbar-brand-mark"
          company={company.data ?? null}
          alt={storeName}
        />
        <span className="pos-topbar-brand-name" title={storeName}>
          {storeName}
        </span>
      </div>
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
          <span className="pos-shortcut-key">F3</span> procedimentos ·{' '}
          <span className="pos-shortcut-key">F4</span> cliente ·{' '}
          <span className="pos-shortcut-key">F8</span> desconto ·{' '}
          <span className="pos-shortcut-key">F9</span> acréscimo ·{' '}
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
        <button
          type="button"
          className="pos-btn pos-btn-ghost"
          onClick={onOpenProcedures}
          title="Sangria, despesas e suprimentos (F3)"
        >
          Procedimentos <span className="pos-shortcut-key">F3</span>
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
  merchandiseTotal,
  cardFeeSurcharge,
  subtotal,
  discount,
  surcharge,
  feeBreakdown,
  guestCount,
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
  merchandiseTotal: number;
  cardFeeSurcharge: number;
  subtotal: number;
  discount: number;
  surcharge: number;
  feeBreakdown?: { serviceFee: number; couvert: number; waiterTip: number; feesTotal: number } | null;
  guestCount?: number;
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
  const formsQ = useQuery({
    queryKey: ['payment-forms', 'active'],
    queryFn: () => api<PaymentForm[]>('/payment-forms?active=1'),
  });

  const tiles = useMemo(() => {
    const forms = formsQ.data ?? [];
    if (forms.length > 0) {
      return forms.map((f) => ({
        id: f.id,
        kind: f.kind as PaymentKind,
        label: f.name,
        icon: kindIcon(f.kind),
        form: f,
      }));
    }
    return PAY_METHODS.map((m) => ({
      id: m.key,
      kind: m.key,
      label: m.label,
      icon: m.icon,
      form: null as PaymentForm | null,
    }));
  }, [formsQ.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tiles.find((t) => t.id === (selectedId ?? tiles[0]?.id)) ?? tiles[0];
  const method = selected?.kind ?? 'CASH';
  const [amountStr, setAmountStr] = useState('');
  const [installments, setInstallments] = useState('1');
  const amountInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedId && tiles[0]) setSelectedId(tiles[0].id);
  }, [tiles, selectedId]);

  const fullyPaid = Math.abs(remaining) <= 0.005;
  const canFinish = total > 0 && fullyPaid;

  useEffect(() => {
    amountInputRef.current?.focus();
    amountInputRef.current?.select();
  }, [selectedId]);

  const showInstallments =
    isCustomerCreditKind(method) ||
    (method === 'CARD' &&
      selected?.form?.cardOperation === 'CREDIT' &&
      (selected.form.maxInstallments ?? 1) > 1);

  function addPayment(opts?: { fullAmount?: boolean }) {
    const parsed = parseDecimal(amountStr);
    const value = opts?.fullAmount || parsed <= 0 ? remaining : parsed;
    if (value <= 0 || !selected) return;
    const maxInst = selected.form?.maxInstallments ?? 48;
    onAddPayment({
      id: uid(),
      method,
      amount: Math.round(value * 100) / 100,
      installments: showInstallments
        ? Math.min(Math.max(1, parseInt(installments, 10) || 1), maxInst)
        : 1,
      paymentFormId: selected.form?.id ?? null,
      paymentFormName: selected.form?.name ?? selected.label,
    });
    setAmountStr('');
    setTimeout(() => amountInputRef.current?.focus(), 0);
  }

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
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isInputFocused = tag === 'input' || tag === 'select' || tag === 'textarea';
      if (!isInputFocused) {
        const idx = Number(ev.key) - 1;
        if (idx >= 0 && idx < tiles.length && idx < 9) {
          ev.preventDefault();
          setSelectedId(tiles[idx]!.id);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canFinish, isFinishing, onCancel, onConfirm, tiles]);

  const feePreview =
    selected?.form?.kind === 'CARD' && remaining > 0
      ? calcAdminFee(
          parseDecimal(amountStr) > 0 ? parseDecimal(amountStr) : remaining,
          selected.form.adminFeePercent,
          selected.form.adminFeeFixed,
        )
      : 0;

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
          {feeBreakdown && feeBreakdown.feesTotal > 0.005 ? (
            <span className="pos-payment-total-detail">
              Subtotal {formatBRL(subtotal)}
              {discount > 0 ? ` · desconto ${formatBRL(discount)}` : ''}
              {feeBreakdown.serviceFee > 0.005
                ? ` · serviço ${formatBRL(feeBreakdown.serviceFee)}`
                : ''}
              {feeBreakdown.couvert > 0.005
                ? ` · couvert ${formatBRL(feeBreakdown.couvert)}${
                    guestCount && guestCount > 1 ? ` (${guestCount}p)` : ''
                  }`
                : ''}
              {feeBreakdown.waiterTip > 0.005
                ? ` · garçom ${formatBRL(feeBreakdown.waiterTip)}`
                : ''}
              {cardFeeSurcharge > 0.005
                ? ` · taxa cartão ${formatBRL(cardFeeSurcharge)}`
                : ''}
            </span>
          ) : discount > 0 || surcharge > 0 || cardFeeSurcharge > 0.005 ? (
            <span className="pos-payment-total-detail">
              Mercadoria {formatBRL(merchandiseTotal)}
              {discount > 0 ? ` · desconto ${formatBRL(discount)}` : ''}
              {surcharge > 0 ? ` · acréscimo ${formatBRL(surcharge)}` : ''}
              {cardFeeSurcharge > 0.005
                ? ` · taxa cartão (repasse) ${formatBRL(cardFeeSurcharge)}`
                : ''}
            </span>
          ) : null}
        </div>

        <div className="pos-payment-body">
          <div className="pos-payment-methods-grid">
            {tiles.map((m, i) => (
              <button
                key={m.id}
                type="button"
                className={`pos-payment-tile ${selected?.id === m.id ? 'is-active' : ''}`}
                onClick={() => setSelectedId(m.id)}
              >
                {i < 9 ? <span className="pos-payment-tile-shortcut">{i + 1}</span> : null}
                <span className="pos-payment-tile-icon" aria-hidden>
                  {m.icon}
                </span>
                <span className="pos-payment-tile-label">{m.label}</span>
                {m.form?.kind === 'CARD' ? (
                  <span style={{ fontSize: '0.65rem', opacity: 0.85 }}>
                    {cardBrandLabel(m.form.cardBrand)} · {cardOperationLabel(m.form.cardOperation)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="pos-payment-controls">
            <div className="pos-payment-field">
              <label htmlFor="pay-overlay-amount">
                Valor em {selected?.label ?? 'pagamento'}
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
              {feePreview > 0 ? (
                <small style={{ color: 'var(--color-text-muted)' }}>
                  {selected?.form?.passAdminFeeToCustomer
                    ? `Repasse ao cliente: ${formatBRL(feePreview)} · no cartão ${(
                        (parseDecimal(amountStr) > 0 ? parseDecimal(amountStr) : remaining) +
                        feePreview
                      ).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                    : `Taxa adm. estimada (custo loja): ${formatBRL(feePreview)}`}
                </small>
              ) : null}
            </div>
            {showInstallments && (
              <div className="pos-payment-field" style={{ maxWidth: 130 }}>
                <label htmlFor="pay-overlay-inst">Parcelas</label>
                <input
                  id="pay-overlay-inst"
                  type="number"
                  min={1}
                  max={selected?.form?.maxInstallments ?? 48}
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
              title="Lançar o valor restante nesta forma"
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
                    <span aria-hidden>{meta?.icon ?? '💳'}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>
                      {p.paymentFormName ?? meta?.label ?? p.method}
                      {(isCustomerCreditKind(p.method) || p.method === 'CARD') &&
                        p.installments > 1 &&
                        ` · ${p.installments}×`}
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
              <strong>{formatBRL(fullyPaid ? change : remaining)}</strong>
            </div>
          </div>
        </div>

        <div className="pos-payment-footer">
          <span className="pos-payment-tip">
            Atalhos: teclas numéricas escolhem a forma ·{' '}
            <span className="pos-shortcut-key">Enter</span> adicionar ·{' '}
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
