import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isManager } from '../lib/auth';
import { formatBRL } from '../lib/format';
import {
  expectedFinalForReconKey,
  formatCashExpectedHint,
  sumReconciliationTotals,
  type CashMovementBreakdown,
} from '../lib/cash-reconciliation';
import { CostCenterSelect } from '../components/CostCenterSelect';

type ReconciliationExpenseDetailLine = {
  amount: number;
  notes: string | null;
  referentialAccountId: string;
  cashMovementId?: string;
  /** Preenchido só na resposta GET (conferência) para exibição legível. */
  referentialAccount?: { id: string; code: string; description: string } | null;
};

type CashUser = { id: string; name: string; email: string };

type CashSessionRow = {
  id: string;
  /** Número de controle humano-legível ("controle") da sessão. */
  controlNumber: number;
  status: 'OPEN' | 'CLOSED';
  openingBalance: string;
  closingBalance: string | null;
  closingByMethod: Record<string, number | string> | null;
  closingNotes: string | null;
  reconciledAt?: string | null;
  reconciledByUserId?: string | null;
  reconciliationNotes?: string | null;
  /** Linhas opcionais de despesa na conferência (valor + observação + centro). */
  reconciliationExpenseDetails?: ReconciliationExpenseDetailLine[] | null;
  reconciledBy?: { id: string; name: string; email?: string } | null;
  openedAt: string;
  closedAt: string | null;
  userId: string;
  user: CashUser | null;
  movementsIn: number;
  movementsOut: number;
  /** Total de vendas COMPLETED na janela do caixa (mesmo critério do detalhe). */
  totalCompletedSales: number;
  /** Declarado total − esperado total (Conciliação); null se não há fechamento/rubrica declarada. */
  reconciliationDifference: number | null;
};

type SaleItemRow = {
  id: string;
  quantity: string;
  unitPrice: string;
  totalLine: string;
  variant: {
    id: string;
    sku: string;
    barcode: string | null;
    /** Preço de venda padrão cadastrado na variação. */
    retailPrice: string;
    product: { name: string; description: string | null };
  };
};

type SaleRow = {
  id: string;
  number: number;
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  source: 'PDV' | 'WHATSAPP';
  total: string;
  subtotal: string;
  discount: string;
  createdAt: string;
  customer: { id: string; name: string } | null;
  payments: Array<{ method: string; amount: string; installments: number }>;
  items: SaleItemRow[];
};

type SessionDetail = {
  session: CashSessionRow & {
    movements: Array<{
      id: string;
      type: 'IN' | 'OUT';
      amount: string;
      method: string | null;
      reason: string | null;
      createdAt: string;
      referentialAccount: { id: string; code: string; description: string } | null;
    }>;
    user: CashUser | null;
  };
  sales: SaleRow[];
  summary: {
    completedCount: number;
    cancelledCount: number;
    totalCompleted: number;
    totalCancelled: number;
    itemsCount: number;
    /** Somatório de descontos em vendas concluídas (linhas + desconto no cupom). */
    totalDiscounts: number;
    byMethod: Record<string, number>;
    movementBreakdown?: CashMovementBreakdown;
  };
};

const STATUS_FILTERS = [
  { value: 'OPEN', label: 'Abertos' },
  { value: 'CLOSED', label: 'Fechados' },
  { value: '', label: 'Todos' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  PIX: 'Pix',
  CREDIT: 'Crediário',
  OTHER: 'Outro',
  EXPENSE: 'Despesa',
};

/** Coluna lista: mesma paleta das diferenças na conciliação do detalhe. */
function listReconciliationDiffCell(value: number | null): ReactNode {
  if (value == null)
    return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  if (Math.abs(value) < 0.005)
    return (
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#15803d' }}>
        {formatBRL(0)}
      </span>
    );
  const positivo = value > 0;
  return (
    <span
      style={{
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 700,
        color: positivo ? '#1d4ed8' : '#b91c1c',
      }}
    >
      {positivo ? '+' : ''}
      {formatBRL(value)}
    </span>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

/** Data em uma linha e hora na outra — ocupa menos largura na tabela de caixa. */
function CompactSessionDatetime({ iso }: { iso: string | null }): ReactNode {
  if (!iso)
    return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
  const timePart = d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const full = d.toLocaleString('pt-BR');
  return (
    <span className="cash-ss-datetime" title={full}>
      <span>{datePart}</span>
      <span>{timePart}</span>
    </span>
  );
}

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Cartão do seletor de modo no modal de impressão. Usado como controle de
 * navegação visual entre "Caixa do dia", "Período", "Controle", "Caixa do
 * funcionário" e "Itens vendidos".
 */
function ModeCard({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      className={'print-mode-card' + (active ? ' is-active' : '')}
      onClick={onClick}
    >
      <strong>{title}</strong>
      <span>{hint}</span>
    </button>
  );
}

export function CashPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const manager = isManager();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [movOpenForId, setMovOpenForId] = useState<string | null>(null);
  const [movType, setMovType] = useState<'IN' | 'OUT'>('OUT');
  const [movOutKind, setMovOutKind] = useState<'WITHDRAWAL' | 'EXPENSE'>('WITHDRAWAL');
  const [movRefId, setMovRefId] = useState('');
  const [movAmount, setMovAmount] = useState('');
  const [movReason, setMovReason] = useState('');
  const [movErr, setMovErr] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printFrom, setPrintFrom] = useState(todayISO());
  const [printTo, setPrintTo] = useState(todayISO());
  /**
   * Modos de impressão do relatório consolidado:
   *  - day:      Caixa do dia (todos os caixas de hoje).
   *  - period:   Período arbitrário com data inicial e final.
   *  - control:  Filtro por número de controle (mínimo e máximo).
   *  - operator: Caixa do dia de um operador específico (data + funcionário).
   *  - items:    Sub-modo para o relatório de itens vendidos.
   */
  const [printMode, setPrintMode] = useState<
    'day' | 'period' | 'control' | 'operator' | 'items'
  >('day');
  const [printUserId, setPrintUserId] = useState<string>('');
  const [printControlFrom, setPrintControlFrom] = useState<string>('');
  const [printControlTo, setPrintControlTo] = useState<string>('');
  const [printItemsStatus, setPrintItemsStatus] = useState<'COMPLETED' | 'CANCELLED' | 'ALL'>(
    'COMPLETED',
  );
  /** Caixa do funcionário: incluir tabela de itens vendidos no relatório consolidado. */
  const [printOperatorDetailItems, setPrintOperatorDetailItems] = useState(false);

  /**
   * Lista de operadores para o seletor "Caixa do dia de um operador".
   * Carregada sob demanda apenas para gerentes (caixa só vê o próprio).
   */
  const operatorsList = useQuery({
    queryKey: ['users'],
    queryFn: () => api<Array<{ id: string; name: string; email: string }>>('/users'),
    enabled: printOpen && manager,
    staleTime: 5 * 60_000,
  });

  /** Intervalo atual de números de controle, para pré-preencher o modo Controle. */
  const controlRange = useQuery({
    queryKey: ['cash', 'control-range'],
    queryFn: () =>
      api<{ min: number | null; max: number | null; count: number }>('/cash/control-range'),
    enabled: printOpen,
    staleTime: 30_000,
  });

  const list = useQuery({
    queryKey: ['cash', 'sessions', statusFilter],
    queryFn: () =>
      api<CashSessionRow[]>(
        `/cash/sessions${statusFilter ? `?status=${statusFilter}` : ''}`,
      ),
    refetchOnMount: 'always',
  });

  const detail = useQuery({
    queryKey: ['cash', 'sessions', detailId, 'detail'],
    queryFn: () => api<SessionDetail>(`/cash/sessions/${detailId}`),
    enabled: !!detailId,
  });

  useEffect(() => {
    if (movType === 'IN') {
      setMovOutKind('WITHDRAWAL');
      setMovRefId('');
    }
  }, [movType]);

  const filtered = useMemo(() => {
    const data = list.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter((s) => {
      const name = s.user?.name?.toLowerCase() ?? '';
      const email = s.user?.email?.toLowerCase() ?? '';
      return name.includes(term) || email.includes(term);
    });
  }, [list.data, search]);

  const movement = useMutation({
    mutationFn: () => {
      const amount = parseFloat(movAmount.replace(',', '.')) || 0;
      if (amount <= 0) {
        throw new Error('Informe um valor válido.');
      }
      if (movType === 'OUT' && movOutKind === 'EXPENSE' && !movRefId.trim()) {
        throw new Error('Selecione o centro de custo para despesas.');
      }
      const json: Record<string, unknown> = {
        type: movType,
        amount,
        reason: movReason.trim() || null,
      };
      if (movType === 'OUT') {
        if (movOutKind === 'EXPENSE') {
          json.method = 'EXPENSE';
          json.referentialAccountId = movRefId.trim();
        } else {
          json.method = null;
        }
      }
      return api('/cash/movement', {
        method: 'POST',
        json,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash', 'sessions'] });
      qc.invalidateQueries({ queryKey: ['cash', 'session'] });
      setMovAmount('');
      setMovReason('');
      setMovRefId('');
      setMovOutKind('WITHDRAWAL');
      setMovErr(null);
      setMovOpenForId(null);
    },
    onError: (e: Error) => setMovErr(e.message),
  });

  return (
    <div className="page">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="page-title">Caixa</h1>
          <p className="page-desc" style={{ marginBottom: 0 }}>
            {manager
              ? 'Visualize todos os caixas do tenant, abra detalhes para conferir vendas e produtos vendidos.'
              : 'Consulte seus caixas abertos e fechados, abra detalhes para conferir as vendas.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border-strong)' }}>
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value || 'ALL'}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                style={{
                  border: 'none',
                  padding: '0.45rem 0.85rem',
                  background: statusFilter === f.value ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: statusFilter === f.value ? '#fff' : 'var(--color-text)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          {manager && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por operador…"
              style={{
                padding: '0.45rem 0.75rem',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 'var(--radius-md)',
                minWidth: 220,
              }}
            />
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPrintOpen(true)}
            title="Imprimir relatório de caixa"
          >
            🖨 Imprimir
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {list.isLoading && (
          <div style={{ padding: '1.25rem', color: 'var(--color-text-secondary)' }}>
            Carregando caixas…
          </div>
        )}
        {list.isError && (
          <div className="alert alert-error" style={{ margin: '1rem' }}>
            {(list.error as Error)?.message ?? 'Erro ao carregar.'}
          </div>
        )}
        {!list.isLoading && !list.isError && (
          <div className="table-wrap table-wrap-cash-sessions">
            <table className="data-table cash-sessions-table">
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8.5%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Operador</th>
                  <th>Estado</th>
                  <th title="Conferência pelo gerente">Conf.</th>
                  <th className="cash-ss-num">
                    Tot.
                    <br />
                    vendas
                  </th>
                  <th
                    className="cash-ss-num"
                    title="Diferença de conferência: declarado menos esperado (mesmo critério do detalhe)"
                  >
                    Dif.
                    <br />
                    conf.
                  </th>
                  <th title="Abertura do caixa">
                    Aberto
                    <br />
                    em
                  </th>
                  <th title="Fechado em">
                    Fechado
                    <br />
                    em
                  </th>
                  <th className="cash-ss-num" title="Saldo inicial">
                    Sd.
                    <br />
                    inicial
                  </th>
                  <th className="cash-ss-num" title="Suprimentos (+) e sangrias / retiradas (−)">
                    +/-
                    <br />
                    cx.
                  </th>
                  <th className="cash-ss-num" title="Saldo final declarado">
                    Sd.
                    <br />
                    final
                  </th>
                  <th className="col-actions cash-ss-num" title="Ir ao detalhe da sessão">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                      Nenhum caixa encontrado para este filtro.
                    </td>
                  </tr>
                )}
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td className="cash-ss-num">
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.08rem 0.35rem',
                          background: 'var(--color-surface-elevated)',
                          border: '1px solid var(--color-border-strong)',
                          borderRadius: 5,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                          fontWeight: 700,
                          fontSize: '0.76rem',
                        }}
                        title={`ID: ${s.id}`}
                      >
                        #{s.controlNumber}
                      </span>
                    </td>
                    <td className="cash-ss-col-operator" title={[s.user?.name, s.user?.email].filter(Boolean).join(' · ') || undefined}>
                      <span className="cash-ss-operator-name">{s.user?.name ?? '—'}</span>
                      {s.user?.email ? <span className="cash-ss-operator-mail">{s.user.email}</span> : null}
                    </td>
                    <td>
                      <span
                        className="cash-ss-chip"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.18rem',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'middle',
                          padding: '0.1rem 0.38rem',
                          borderRadius: '999px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          lineHeight: 1.2,
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                          background: s.status === 'OPEN' ? 'rgba(22,163,74,0.12)' : 'rgba(148,163,184,0.18)',
                          color: s.status === 'OPEN' ? '#15803d' : '#64748b',
                        }}
                      >
                        {s.status === 'OPEN' ? (
                          <>
                            <span aria-hidden style={{ lineHeight: 1 }}>
                              ●
                            </span>
                            Aberto
                          </>
                        ) : (
                          'Fechado'
                        )}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.75rem', lineHeight: 1.2 }}>
                      {s.status === 'OPEN' ? (
                        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                      ) : s.reconciledAt ? (
                        <span
                          title={
                            [
                              'Conferido',
                              s.reconciledBy?.name ? `por ${s.reconciledBy.name}` : '',
                            ]
                              .filter(Boolean)
                              .join(' ')
                          }
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            whiteSpace: 'nowrap',
                            verticalAlign: 'middle',
                            padding: '0.1rem 0.38rem',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            lineHeight: 1.15,
                            maxWidth: '100%',
                            overflow: 'hidden',
                            background: 'rgba(22,163,74,0.16)',
                            color: '#15803d',
                          }}
                        >
                          Conc.
                        </span>
                      ) : (
                        <span
                          title={manager ? 'Pendente de conferência' : 'Aguardando conferência'}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            whiteSpace: 'nowrap',
                            verticalAlign: 'middle',
                            padding: '0.1rem 0.38rem',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            lineHeight: 1.15,
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            background: 'rgba(234,179,8,0.18)',
                            color: '#a16207',
                          }}
                        >
                          {manager ? 'Pend.' : 'Aguard.'}
                        </span>
                      )}
                    </td>
                    <td className="cash-ss-num" style={{ fontWeight: 600 }}>
                      {formatBRL(s.totalCompletedSales)}
                    </td>
                    <td className="cash-ss-num">{listReconciliationDiffCell(s.reconciliationDifference)}</td>
                    <td>
                      <CompactSessionDatetime iso={s.openedAt} />
                    </td>
                    <td>
                      <CompactSessionDatetime iso={s.closedAt} />
                    </td>
                    <td className="cash-ss-num">{formatBRL(s.openingBalance)}</td>
                    <td className="cash-ss-num cash-ss-movements-cell">
                      <span style={{ color: '#15803d' }}>+{formatBRL(s.movementsIn)}</span>
                      <br />
                      <span style={{ color: '#b91c1c' }}>−{formatBRL(s.movementsOut)}</span>
                    </td>
                    <td className="cash-ss-num">{s.closingBalance ? formatBRL(s.closingBalance) : '—'}</td>
                    <td className="col-actions cash-ss-num">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        title="Ver detalhes da sessão"
                        style={{ padding: '0.26rem 0.45rem', fontSize: '0.74rem', whiteSpace: 'nowrap' }}
                        onClick={() => setDetailId(s.id)}
                      >
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailId && (
        <SessionDetailDrawer
          detail={detail.data}
          loading={detail.isLoading}
          error={detail.isError ? (detail.error as Error).message : null}
          onClose={() => setDetailId(null)}
          onRefresh={() => {
            void list.refetch();
            void detail.refetch();
          }}
          onOpenMovement={(sessionId) => {
            setMovOpenForId(sessionId);
            setMovType('OUT');
            setMovOutKind('WITHDRAWAL');
            setMovRefId('');
            setMovAmount('');
            setMovReason('');
            setMovErr(null);
          }}
        />
      )}

      {printOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setPrintOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640 }}
          >
            <h2>Imprimir relatório de caixa</h2>

            {/* Seletor de modo: 5 cartões compactos */}
            <div className="print-modes">
              <ModeCard
                active={printMode === 'day'}
                onClick={() => setPrintMode('day')}
                title="Caixa do dia"
                hint="Tudo de hoje"
              />
              <ModeCard
                active={printMode === 'period'}
                onClick={() => setPrintMode('period')}
                title="Período"
                hint="Data inicial → final"
              />
              <ModeCard
                active={printMode === 'control'}
                onClick={() => setPrintMode('control')}
                title="Controle"
                hint="Nº mín. → máx."
              />
              <ModeCard
                active={printMode === 'operator'}
                onClick={() => setPrintMode('operator')}
                title="Caixa do funcionário"
                hint="Operador + data"
              />
              <ModeCard
                active={printMode === 'items'}
                onClick={() => setPrintMode('items')}
                title="Itens vendidos"
                hint="Detalhe item a item"
              />
            </div>

            {/* === MODO: CAIXA DO DIA === */}
            {printMode === 'day' && (
              <div className="print-mode-panel">
                <p className="print-mode-desc">
                  Gera o relatório com todos os caixas abertos/fechados hoje.
                </p>
                <div className="print-mode-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      const t = todayISO();
                      navigate(`/caixa/impressao?from=${t}&to=${t}`);
                    }}
                  >
                    Gerar relatório de hoje
                  </button>
                </div>
              </div>
            )}

            {/* === MODO: PERÍODO === */}
            {printMode === 'period' && (
              <div className="print-mode-panel">
                <p className="print-mode-desc">
                  Escolha a data inicial e final do relatório.
                </p>
                <div className="form-row" style={{ alignItems: 'flex-end' }}>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="print-from">Data inicial</label>
                    <input
                      id="print-from"
                      type="date"
                      value={printFrom}
                      onChange={(e) => setPrintFrom(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="print-to">Data final</label>
                    <input
                      id="print-to"
                      type="date"
                      value={printTo}
                      onChange={(e) => setPrintTo(e.target.value)}
                    />
                  </div>
                </div>
                <div className="print-mode-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const t = todayISO();
                      const d = new Date();
                      d.setDate(d.getDate() - 7);
                      const week = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                      setPrintFrom(week);
                      setPrintTo(t);
                    }}
                  >
                    Últimos 7 dias
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const t = todayISO();
                      const d = new Date();
                      d.setDate(d.getDate() - 30);
                      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                      setPrintFrom(m);
                      setPrintTo(t);
                    }}
                  >
                    Últimos 30 dias
                  </button>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!printFrom || !printTo}
                    onClick={() =>
                      navigate(`/caixa/impressao?from=${printFrom}&to=${printTo}`)
                    }
                  >
                    Gerar relatório
                  </button>
                </div>
              </div>
            )}

            {/* === MODO: CONTROLE === */}
            {printMode === 'control' && (
              <div className="print-mode-panel">
                <p className="print-mode-desc">
                  Imprima um intervalo específico de caixas pelo número de controle.
                  {controlRange.data && (
                    <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.78rem' }}>
                      Controles existentes:{' '}
                      <strong>
                        #{controlRange.data.min ?? '—'} a #{controlRange.data.max ?? '—'}
                      </strong>{' '}
                      ({controlRange.data.count} caixa{controlRange.data.count === 1 ? '' : 's'})
                    </span>
                  )}
                </p>
                <div className="form-row" style={{ alignItems: 'flex-end' }}>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="print-control-from">Controle mínimo</label>
                    <input
                      id="print-control-from"
                      type="number"
                      min={1}
                      placeholder={
                        controlRange.data?.min ? `#${controlRange.data.min}` : '#1'
                      }
                      value={printControlFrom}
                      onChange={(e) => setPrintControlFrom(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="print-control-to">Controle máximo</label>
                    <input
                      id="print-control-to"
                      type="number"
                      min={1}
                      placeholder={
                        controlRange.data?.max ? `#${controlRange.data.max}` : '#999'
                      }
                      value={printControlTo}
                      onChange={(e) => setPrintControlTo(e.target.value)}
                    />
                  </div>
                </div>
                <div className="print-mode-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      if (controlRange.data?.min) setPrintControlFrom(String(controlRange.data.min));
                      if (controlRange.data?.max) setPrintControlTo(String(controlRange.data.max));
                    }}
                  >
                    Todos
                  </button>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!printControlFrom && !printControlTo}
                    onClick={() => {
                      const qs = new URLSearchParams();
                      if (printControlFrom) qs.set('controlFrom', printControlFrom);
                      if (printControlTo) qs.set('controlTo', printControlTo);
                      navigate(`/caixa/impressao?${qs.toString()}`);
                    }}
                  >
                    Gerar relatório
                  </button>
                </div>
              </div>
            )}

            {/* === MODO: CAIXA DO FUNCIONÁRIO === */}
            {printMode === 'operator' && (
              <div className="print-mode-panel">
                <p className="print-mode-desc">
                  Imprima o(s) caixa(s) de um operador específico em uma determinada data.
                </p>
                <div className="form-row" style={{ alignItems: 'flex-end' }}>
                  <div className="field" style={{ flex: 2, marginBottom: 0 }}>
                    <label htmlFor="print-operator-user">Operador</label>
                    <select
                      id="print-operator-user"
                      value={printUserId}
                      onChange={(e) => setPrintUserId(e.target.value)}
                      disabled={!manager}
                    >
                      <option value="">
                        {manager ? 'Selecione o operador…' : 'Apenas o seu próprio caixa'}
                      </option>
                      {(operatorsList.data ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} — {u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="print-operator-date">Data</label>
                    <input
                      id="print-operator-date"
                      type="date"
                      value={printFrom}
                      onChange={(e) => {
                        setPrintFrom(e.target.value);
                        setPrintTo(e.target.value);
                      }}
                    />
                  </div>
                </div>
                <label
                  className="print-mode-check"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    marginTop: '0.65rem',
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={printOperatorDetailItems}
                    onChange={(e) => setPrintOperatorDetailItems(e.target.checked)}
                  />
                  Detalhar itens vendidos no caixa
                </label>
                <div className="print-mode-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const t = todayISO();
                      setPrintFrom(t);
                      setPrintTo(t);
                    }}
                  >
                    Hoje
                  </button>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!printFrom || (manager && !printUserId)}
                    onClick={() => {
                      const qs = new URLSearchParams({
                        from: printFrom,
                        to: printFrom,
                      });
                      if (printUserId) qs.set('userId', printUserId);
                      if (printOperatorDetailItems) qs.set('detailItems', '1');
                      navigate(`/caixa/impressao?${qs.toString()}`);
                    }}
                  >
                    Gerar relatório
                  </button>
                </div>
              </div>
            )}

            {/* === MODO: ITENS VENDIDOS === */}
            {printMode === 'items' && (
              <div className="print-mode-panel">
                <p className="print-mode-desc">
                  Lista detalhada de cada item vendido. Filtre por período e/ou operador.
                </p>
                <div className="form-row" style={{ alignItems: 'flex-end' }}>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="print-items-from">De</label>
                    <input
                      id="print-items-from"
                      type="date"
                      value={printFrom}
                      onChange={(e) => setPrintFrom(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="print-items-to">Até</label>
                    <input
                      id="print-items-to"
                      type="date"
                      value={printTo}
                      onChange={(e) => setPrintTo(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-row" style={{ alignItems: 'flex-end', marginTop: '0.5rem' }}>
                  {manager && (
                    <div className="field" style={{ flex: 2, marginBottom: 0 }}>
                      <label htmlFor="print-items-user">Operador</label>
                      <select
                        id="print-items-user"
                        value={printUserId}
                        onChange={(e) => setPrintUserId(e.target.value)}
                      >
                        <option value="">Todos os operadores</option>
                        {(operatorsList.data ?? []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} — {u.email}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="print-items-status">Status</label>
                    <select
                      id="print-items-status"
                      value={printItemsStatus}
                      onChange={(e) =>
                        setPrintItemsStatus(e.target.value as 'COMPLETED' | 'CANCELLED' | 'ALL')
                      }
                    >
                      <option value="COMPLETED">Concluídas</option>
                      <option value="CANCELLED">Canceladas</option>
                      <option value="ALL">Todas</option>
                    </select>
                  </div>
                </div>

                <div className="print-mode-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const t = todayISO();
                      setPrintFrom(t);
                      setPrintTo(t);
                    }}
                  >
                    Hoje
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const t = todayISO();
                      const d = new Date();
                      d.setDate(d.getDate() - 7);
                      const week = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                      setPrintFrom(week);
                      setPrintTo(t);
                    }}
                  >
                    7 dias
                  </button>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!printFrom || !printTo}
                    onClick={() => {
                      const qs = new URLSearchParams({
                        from: printFrom,
                        to: printTo,
                        status: printItemsStatus,
                      });
                      if (printUserId) qs.set('userId', printUserId);
                      navigate(`/caixa/impressao/itens?${qs.toString()}`);
                    }}
                  >
                    Gerar relatório de itens
                  </button>
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPrintOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {movOpenForId && (
        <div className="modal-backdrop" role="presentation" onClick={() => setMovOpenForId(null)}>
          <div
            className="modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460 }}
          >
            <h2>Movimentar caixa</h2>
            <p style={{ marginTop: 0, color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
              Lance sangria, suprimento ou <strong>despesa</strong> (com centro de custo do plano
              referencial) no seu caixa atual. Operadores só podem movimentar o próprio caixa.
            </p>
            {movErr && <div className="alert alert-error">{movErr}</div>}
            <div className="form-row">
              <div className="field">
                <label>Tipo</label>
                <select
                  value={movType}
                  onChange={(e) => setMovType(e.target.value as 'IN' | 'OUT')}
                >
                  <option value="OUT">Saída</option>
                  <option value="IN">Entrada (suprimento)</option>
                </select>
              </div>
              {movType === 'OUT' && (
                <div className="field">
                  <label>Saída</label>
                  <select
                    value={movOutKind}
                    onChange={(e) =>
                      setMovOutKind(e.target.value as 'WITHDRAWAL' | 'EXPENSE')
                    }
                  >
                    <option value="WITHDRAWAL">Sangria</option>
                    <option value="EXPENSE">Despesa (centro de custo)</option>
                  </select>
                </div>
              )}
              <div className="field">
                <label>Valor (R$)</label>
                <input
                  value={movAmount}
                  onChange={(e) => setMovAmount(e.target.value)}
                  type="number"
                  step="0.01"
                  autoFocus
                />
              </div>
            </div>
            {movType === 'OUT' && movOutKind === 'EXPENSE' && (
              <CostCenterSelect
                flow="EXPENSE"
                id="cash-mov-cost-center"
                value={movRefId}
                onChange={setMovRefId}
                allowEmpty={false}
                emptyLabel="— Selecione —"
                label="Centro de custo *"
              />
            )}
            <div className="field">
              <label>Observações</label>
              <input value={movReason} onChange={(e) => setMovReason(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setMovOpenForId(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={movement.isPending}
                onClick={() => movement.mutate()}
              >
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type CashReconRow = {
  key: string;
  expectedFinal: number;
  declaredVal: number | null;
  diff: number | null;
};

/** Formas usadas no fechamento / conferência (pagamentos + total de despesas de caixa). */
const RECON_MANAGEABLE_METHOD_KEYS = ['CASH', 'CARD', 'PIX', 'CREDIT', 'OTHER', 'EXPENSE'] as const;

function sortReconMethodKeys(keys: string[]): string[] {
  const order = [...RECON_MANAGEABLE_METHOD_KEYS];
  return [...keys].sort((a, b) => {
    const ia = order.indexOf(a as (typeof RECON_MANAGEABLE_METHOD_KEYS)[number]);
    const ib = order.indexOf(b as (typeof RECON_MANAGEABLE_METHOD_KEYS)[number]);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function buildCashReconciliationRows(
  session: SessionDetail['session'],
  expected: Record<string, number>,
): CashReconRow[] {
  const declared = session.closingByMethod ?? null;
  const methodKeys = Array.from(
    new Set([...Object.keys(expected), ...Object.keys(declared ?? {}), 'CASH']),
  );
  if (methodKeys.length === 0) return [];
  const opening = parseFloat(session.openingBalance) || 0;
  const rows = methodKeys.map((key) => {
    const expectedFinal = expectedFinalForReconKey(key, expected, opening);
    const rawDeclared = declared ? declared[key] : null;
    const declaredVal =
      rawDeclared == null
        ? null
        : typeof rawDeclared === 'number'
          ? rawDeclared
          : parseFloat(String(rawDeclared).replace(',', '.'));
    const diff = declaredVal == null ? null : declaredVal - expectedFinal;
    return { key, expectedFinal, declaredVal, diff };
  });
  return rows.filter((r) => r.expectedFinal > 0 || r.declaredVal != null);
}

/** Linhas editáveis: movimentações apuradas + o que já veio no fechamento + linhas extras do gerente. */
function mergeManagerReconciliationKeys(
  visibleRows: CashReconRow[],
  closingByMethod: Record<string, number | string> | null | undefined,
  addedMethodKeys: string[],
): string[] {
  const s = new Set<string>();
  for (const r of visibleRows) s.add(r.key);
  if (closingByMethod && typeof closingByMethod === 'object') {
    for (const k of Object.keys(closingByMethod)) s.add(k);
  }
  for (const k of addedMethodKeys) s.add(k);
  return sortReconMethodKeys([...s]);
}

function ManagerCashReconciliation({
  session,
  expected,
  movementBreakdown,
  onUpdated,
}: {
  session: SessionDetail['session'];
  expected: Record<string, number>;
  movementBreakdown?: CashMovementBreakdown;
  onUpdated: () => void;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [addedMethodKeys, setAddedMethodKeys] = useState<string[]>([]);
  const [pickToAdd, setPickToAdd] = useState('');

  useEffect(() => {
    setAddedMethodKeys([]);
    setPickToAdd('');
    setExpenseDetailExpanded(true);
  }, [session.id]);

  const visible = useMemo(() => buildCashReconciliationRows(session, expected), [session, expected]);

  const declJson = useMemo(() => JSON.stringify(session.closingByMethod ?? {}), [session.closingByMethod]);

  const expectedSig = useMemo(() => JSON.stringify(expected), [expected]);

  const visibleKeysSig = useMemo(
    () =>
      buildCashReconciliationRows(session, expected)
        .map((r) => r.key)
        .sort()
        .join('|'),
    [session.id, declJson, expectedSig, session.openingBalance],
  );

  const opening = useMemo(() => parseFloat(session.openingBalance) || 0, [session.openingBalance]);

  const mergedKeys = useMemo(
    () =>
      mergeManagerReconciliationKeys(visible, session.closingByMethod, addedMethodKeys),
    [visible, session.closingByMethod, addedMethodKeys],
  );

  const [draft, setDraft] = useState<Record<string, string>>({});

  type ExpenseLineDraft = {
    uid: string;
    amount: string;
    notes: string;
    referentialAccountId: string;
    cashMovementId?: string;
  };

  const [expenseLineDrafts, setExpenseLineDrafts] = useState<ExpenseLineDraft[]>([]);
  /** Após gravar ou manualmente (`Ocultar`), o painel de linhas pode ficar recolhido. */
  const [expenseDetailExpanded, setExpenseDetailExpanded] = useState(true);

  const reconciliationExpenseSig = useMemo(
    () => JSON.stringify(session.reconciliationExpenseDetails ?? null),
    [session.reconciliationExpenseDetails],
  );

  /** Somatório das linhas de despesa com valor numérico &gt; 0 (feedback na UI). */
  const expenseDetailedSumPositive = useMemo(() => {
    let sum = 0;
    for (const row of expenseLineDrafts) {
      const raw = row.amount.trim().replace(',', '.');
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) sum += Math.round(n * 100) / 100;
    }
    return Math.round(sum * 100) / 100;
  }, [expenseLineDrafts]);

  /** Há pelo menos uma linha preenchida o suficiente para exigir as demais (detalhar despesa). */
  const expenseLineStartsDetail = expenseLineDrafts.some(
    (r) =>
      r.amount.trim() !== '' || r.referentialAccountId.trim() !== '' || r.notes.trim() !== '',
  );

  /** Linhas de despesa com valor válido + centro — usadas no salvamento e no resumo recolhido. */
  const expenseCompleteDraftLines = useMemo(
    () =>
      expenseLineDrafts.filter((r) => {
        const raw = r.amount.trim().replace(',', '.');
        const n = parseFloat(raw);
        return Number.isFinite(n) && n > 0 && r.referentialAccountId.trim() !== '';
      }),
    [expenseLineDrafts],
  );

  const hasCommittedExpenseLines = expenseCompleteDraftLines.length > 0;

  /** Declarado oficial no servidor ou após salvar — resincroniza o rascunho e limpa inclusões só locais. */
  useEffect(() => {
    const decl = session.closingByMethod;
    const keys = mergeManagerReconciliationKeys(
      buildCashReconciliationRows(session, expected),
      decl,
      [],
    );
    const next: Record<string, string> = {};
    for (const k of keys) {
      const raw = decl?.[k];
      next[k] = raw == null ? '' : String(typeof raw === 'number' ? raw : raw);
    }
    setDraft(next);
    setAddedMethodKeys([]);
  }, [session.id, session.reconciledAt, declJson, expectedSig, session.openingBalance, visibleKeysSig]);

  useEffect(() => {
    const raw = session.reconciliationExpenseDetails;
    if (Array.isArray(raw) && raw.length > 0) {
      setExpenseLineDrafts(
        raw.map((row) => ({
          uid: crypto.randomUUID(),
          amount:
            typeof row.amount === 'number' && Number.isFinite(row.amount)
              ? String(row.amount)
              : row.amount != null
                ? String(row.amount).replace('.', ',')
                : '',
          notes: row.notes ? String(row.notes) : '',
          referentialAccountId: row.referentialAccountId ? String(row.referentialAccountId) : '',
          ...(row.cashMovementId ? { cashMovementId: String(row.cashMovementId) } : {}),
        })),
      );
    } else {
      setExpenseLineDrafts([]);
    }
  }, [session.id, reconciliationExpenseSig]);

  /** Linhas extras incluídas pelo gerente (antes de gravar ou após servidor sem esse campo). */
  useEffect(() => {
    if (addedMethodKeys.length === 0) return;
    const decl = session.closingByMethod;
    setDraft((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const k of addedMethodKeys) {
        if (!(k in next)) {
          const raw = decl?.[k];
          next[k] = raw == null ? '' : String(typeof raw === 'number' ? raw : raw);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [addedMethodKeys.join('|'), declJson]);

  const patchDeclared = useMutation({
    mutationFn: (payload: {
      closingByMethod: Record<string, number>;
      reconciliationExpenseDetails?: unknown | null;
    }) => {
      const json: Record<string, unknown> = { closingByMethod: payload.closingByMethod };
      if (payload.reconciliationExpenseDetails !== undefined) {
        json.reconciliationExpenseDetails = payload.reconciliationExpenseDetails;
      }
      return api(`/cash/sessions/${session.id}/declared-amounts`, {
        method: 'PATCH',
        json,
      });
    },
    onSuccess: () => {
      setErr(null);
      setExpenseDetailExpanded(false);
      void qc.invalidateQueries({ queryKey: ['financial-overview'] });
      onUpdated();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const reconcile = useMutation({
    mutationFn: () =>
      api(`/cash/sessions/${session.id}/reconcile`, {
        method: 'POST',
        json: { notes: notes.trim() || null },
      }),
    onSuccess: () => {
      setErr(null);
      setNotes('');
      onUpdated();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const unreconcile = useMutation({
    mutationFn: () => api(`/cash/sessions/${session.id}/unreconcile`, { method: 'POST' }),
    onSuccess: () => {
      setErr(null);
      onUpdated();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const availableToAdd = useMemo(
    () => RECON_MANAGEABLE_METHOD_KEYS.filter((k) => !mergedKeys.includes(k)),
    [mergedKeys],
  );

  if (!isManager()) return null;
  if (session.status !== 'CLOSED') return null;

  if (session.reconciledAt) {
    return (
      <div className="card" style={{ marginBottom: '1rem', padding: '0.9rem 1rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <strong style={{ fontSize: '0.92rem', color: '#15803d' }}>Conferência finalizada</strong>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
              Conferido em <strong>{fmtDateTime(session.reconciledAt)}</strong>
              {session.reconciledBy ? (
                <>
                  {' '}
                  por <strong>{session.reconciledBy.name}</strong>
                </>
              ) : null}
              .
            </p>
            {session.reconciliationNotes ? (
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                <em>Notas da conferência:</em> {session.reconciliationNotes}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem' }}
            disabled={unreconcile.isPending}
            onClick={() => {
              if (confirm('Reabrir conferência? Os apresentados poderão ser alterados novamente.')) {
                unreconcile.mutate();
              }
            }}
          >
            Reabrir conferência
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '0.9rem 1rem' }}>
      <strong style={{ fontSize: '0.92rem' }}>Conferência do gerente</strong>
      <p style={{ margin: '0.35rem 0 0.75rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
        Edite valores já informados,{' '}
        <strong>inclua novas linhas</strong> (cartão, Pix, crediário). Em{' '}
        <strong>Despesas</strong> você pode usar um total único ou <strong>detalhar várias linhas</strong>{' '}
        (valor, observação e centro de custo). Linhas detalhadas geram movimentos de caixa classificados e entram no{' '}
        <strong>Balanço</strong> e no relatório por centro de custo ao salvar.
      </p>
      {err && (
        <div className="alert alert-error" style={{ marginBottom: '0.65rem' }}>
          {err}
        </div>
      )}
      <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.65rem' }}>
        {mergedKeys.map((key) => {
          const exp = expectedFinalForReconKey(key, expected, opening);
          const isManualExtra = addedMethodKeys.includes(key);
          const isExpenseRow = key === 'EXPENSE';
          return (
            <Fragment key={key}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isManualExtra ? 'minmax(0,1fr) auto 118px' : 'minmax(0,1fr) 118px',
                  gap: '0.5rem',
                  alignItems: 'center',
                  fontSize: '0.85rem',
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{PAYMENT_LABELS[key] ?? key}</span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.75rem',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    Esperado (referência){' '}
                    <strong>{formatBRL(exp)}</strong>
                    {key === 'CASH' ? (
                      <>
                        {' '}
                        · {formatCashExpectedHint(opening, movementBreakdown)}
                      </>
                    ) : key === 'EXPENSE' ? (
                      ' · analítico (não soma no apresentado total)'
                    ) : null}
                  </span>
                  {isExpenseRow && expenseLineStartsDetail ? (
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.74rem',
                        color: '#a16207',
                        marginTop: '0.2rem',
                      }}
                    >
                      Detalhes preenchidos: total apresentado em despesas ={' '}
                      <strong>{formatBRL(hasCommittedExpenseLines ? expenseDetailedSumPositive : 0)}</strong>
                      {!hasCommittedExpenseLines ? ' · conclua valor e centro em cada linha para gravar.' : null}
                    </span>
                  ) : null}
                </div>
                {isManualExtra ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    title="Remover linha só desta conferência (ainda não salva no servidor ou incluída agora)."
                    disabled={patchDeclared.isPending}
                    style={{ padding: '0.2rem 0.45rem', fontSize: '0.76rem', color: '#b91c1c' }}
                    onClick={() => {
                      setAddedMethodKeys((a) => a.filter((x) => x !== key));
                      setDraft((d) => {
                        const n = { ...d };
                        delete n[key];
                        return n;
                      });
                      if (key === 'EXPENSE') {
                        setExpenseLineDrafts([]);
                      }
                    }}
                  >
                    Remover
                  </button>
                ) : null}
                {isExpenseRow && hasCommittedExpenseLines ? (
                  <div
                    style={{
                      padding: '0.4rem 0.5rem',
                      textAlign: 'right',
                      borderRadius: 6,
                      border: '1px solid var(--color-border-strong)',
                      background: 'var(--color-surface-elevated)',
                      fontSize: '0.85rem',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                    title="Total igual à soma das linhas detalhadas"
                  >
                    {formatBRL(expenseDetailedSumPositive)}
                  </div>
                ) : (
                  <input
                    aria-label={`Apresentado ${PAYMENT_LABELS[key] ?? key}`}
                    inputMode="decimal"
                    value={draft[key] ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                    readOnly={isExpenseRow && hasCommittedExpenseLines}
                    placeholder="0"
                    style={{
                      padding: '0.4rem 0.5rem',
                      textAlign: 'right',
                      borderRadius: 6,
                      border: '1px solid var(--color-border-strong)',
                      fontSize: '0.9rem',
                      opacity: isExpenseRow && hasCommittedExpenseLines ? 0.65 : 1,
                    }}
                  />
                )}
              </div>
              {isExpenseRow ? (
                <div
                  style={{
                    marginLeft: '0.35rem',
                    padding: '0.65rem',
                    borderLeft: '2px solid var(--color-border-strong)',
                    borderRadius: 6,
                    background: 'rgba(148,163,184,0.06)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.45rem',
                    }}
                  >
                    <strong style={{ fontSize: '0.8rem' }}>Detalhamento opcional das despesas</strong>
                    {expenseDetailExpanded ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={patchDeclared.isPending}
                        style={{ padding: '0.2rem 0.55rem', fontSize: '0.76rem' }}
                        onClick={() => setExpenseDetailExpanded(false)}
                      >
                        Ocultar detalhes
                      </button>
                    ) : null}
                  </div>
                  {!expenseDetailExpanded ? (
                    <div style={{ marginTop: '0.55rem' }}>
                      <p
                        style={{
                          margin: '0 0 0.45rem',
                          fontSize: '0.8rem',
                          color: 'var(--color-text-secondary)',
                          lineHeight: 1.35,
                        }}
                      >
                        {expenseCompleteDraftLines.length > 0 ? (
                          <>
                            <strong>{expenseCompleteDraftLines.length}</strong> linha(s) válida(s) · total{' '}
                            <strong>{formatBRL(expenseDetailedSumPositive)}</strong>
                          </>
                        ) : expenseLineDrafts.length > 0 ? (
                          <>
                            {expenseLineDrafts.length} linha(s) em rascunho — abra novamente para concluir
                            cadastro ou ajustes.
                          </>
                        ) : (
                          <>
                            Nenhuma linha detalhada; o total só no campo ao lado vale enquanto não adicionar
                            linhas.
                          </>
                        )}
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={patchDeclared.isPending || !!session.reconciledAt}
                        style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
                        onClick={() => setExpenseDetailExpanded(true)}
                      >
                        Expandir detalhes das despesas
                      </button>
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: '0.4rem 0 0.55rem', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
                        Para cada despesa conferida inclua valor e centro de custo (planos grupo 4/5). Observação é
                        livre. Linhas só parcialmente preenchidas não são gravadas até estarem válidas ou removidas.
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.55rem' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={patchDeclared.isPending || !!session.reconciledAt}
                          style={{ padding: '0.3rem 0.55rem', fontSize: '0.76rem' }}
                          onClick={() =>
                            setExpenseLineDrafts((rows) => [
                              ...rows,
                              {
                                uid: crypto.randomUUID(),
                                amount: '',
                                notes: '',
                                referentialAccountId: '',
                              },
                            ])
                          }
                        >
                          Adicionar linha
                        </button>
                        {expenseLineDrafts.length > 0 ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={patchDeclared.isPending || !!session.reconciledAt}
                            style={{ padding: '0.3rem 0.55rem', fontSize: '0.76rem' }}
                            onClick={() => setExpenseLineDrafts([])}
                          >
                            Limpar todas as linhas
                          </button>
                        ) : null}
                      </div>
                      <div style={{ display: 'grid', gap: '0.65rem' }}>
                        {expenseLineDrafts.map((row, idx) => (
                          <div
                            key={row.uid}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0, 92px) minmax(0, 1fr)',
                              gap: '0.5rem',
                              alignItems: 'start',
                              borderTop: idx ? '1px dashed var(--color-border-strong)' : 'none',
                              paddingTop: idx ? '0.55rem' : 0,
                            }}
                          >
                            <div style={{ display: 'grid', gap: '0.35rem' }}>
                              <label
                                htmlFor={`exp-line-amt-${row.uid}`}
                                style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}
                              >
                                Valor
                              </label>
                              <input
                                id={`exp-line-amt-${row.uid}`}
                                inputMode="decimal"
                                value={row.amount}
                                onChange={(e) =>
                                  setExpenseLineDrafts((prev) =>
                                    prev.map((r) =>
                                      r.uid === row.uid ? { ...r, amount: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder="0"
                                disabled={patchDeclared.isPending || !!session.reconciledAt}
                                style={{
                                  padding: '0.35rem',
                                  borderRadius: 6,
                                  border: '1px solid var(--color-border-strong)',
                                  fontSize: '0.85rem',
                                  textAlign: 'right',
                                  width: '100%',
                                }}
                              />
                            </div>
                            <div style={{ display: 'grid', gap: '0.35rem', minWidth: 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                                  Centro de custo · observação
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ padding: '0.15rem 0.4rem', fontSize: '0.72rem', color: '#b91c1c' }}
                                  disabled={patchDeclared.isPending || !!session.reconciledAt}
                                  onClick={() =>
                                    setExpenseLineDrafts((prev) => prev.filter((r) => r.uid !== row.uid))
                                  }
                                >
                                  Remover linha
                                </button>
                              </div>
                              <CostCenterSelect
                                id={`exp-line-cc-${row.uid}`}
                                flow="EXPENSE"
                                label=""
                                emptyLabel="Selecionar…"
                                allowEmpty={true}
                                value={row.referentialAccountId}
                                onChange={(id) =>
                                  setExpenseLineDrafts((prev) =>
                                    prev.map((r) =>
                                      r.uid === row.uid ? { ...r, referentialAccountId: id } : r,
                                    ),
                                  )
                                }
                                disabled={patchDeclared.isPending || !!session.reconciledAt}
                              />
                              <textarea
                                value={row.notes}
                                onChange={(e) =>
                                  setExpenseLineDrafts((prev) =>
                                    prev.map((r) =>
                                      r.uid === row.uid ? { ...r, notes: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder="Observação (opcional)"
                                disabled={patchDeclared.isPending || !!session.reconciledAt}
                                rows={2}
                                style={{
                                  padding: '0.35rem',
                                  borderRadius: 6,
                                  border: '1px solid var(--color-border-strong)',
                                  fontSize: '0.8rem',
                                  width: '100%',
                                  resize: 'vertical',
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      {expenseLineDrafts.length === 0 ? (
                        <p style={{ margin: '0.35rem 0 0', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
                          Sem linhas: use apenas o campo <strong>Apresentado</strong> ao lado ou adicione linhas aqui.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.45rem' }}>
        {availableToAdd.length > 0 ? (
          <>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }} htmlFor="mgr-add-pay-method">
              Incluir
            </label>
            <select
              id="mgr-add-pay-method"
              value={pickToAdd}
              onChange={(e) => setPickToAdd(e.target.value)}
              style={{
                padding: '0.35rem 0.5rem',
                borderRadius: 6,
                border: '1px solid var(--color-border-strong)',
                fontSize: '0.85rem',
              }}
            >
              <option value="">Forma ou despesa…</option>
              {availableToAdd.map((k) => (
                <option key={k} value={k}>
                  {PAYMENT_LABELS[k] ?? k}
                  {k === 'EXPENSE' ? ' — total ou detalhamento por linhas' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.82rem' }}
              disabled={!pickToAdd || patchDeclared.isPending}
              onClick={() => {
                if (!pickToAdd) return;
                if (mergedKeys.includes(pickToAdd)) {
                  setPickToAdd('');
                  return;
                }
                setAddedMethodKeys((a) => [...a, pickToAdd]);
                setPickToAdd('');
              }}
            >
              Adicionar linha
            </button>
          </>
        ) : (
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            Todas as formas previstas já estão na lista — edite nos campos acima ou limpe/remova valores ao salvar.
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={patchDeclared.isPending || mergedKeys.length === 0}
          onClick={() => {
            const closingByMethod: Record<string, number> = {};

            /** Linhas válidas quando houver modo detalhe de despesa. */
            let expenseDetailPayload: Array<{
              amount: number;
              notes: string | null;
              referentialAccountId: string;
              cashMovementId?: string;
            }> | null = null;

            const wantsExpenseBranch = mergedKeys.includes('EXPENSE');

            if (wantsExpenseBranch) {
              const candidateRows = expenseLineDrafts.filter((r) => {
                const amt = r.amount.trim();
                const cc = r.referentialAccountId.trim();
                const nt = r.notes.trim();
                return amt !== '' || cc !== '' || nt !== '';
              });
              const completeRows = candidateRows.filter((r) => {
                const n = parseFloat(r.amount.trim().replace(',', '.'));
                return Number.isFinite(n) && n > 0 && r.referentialAccountId.trim() !== '';
              });
              const invalidPartial = candidateRows.length > completeRows.length;
              if (invalidPartial) {
                setErr(
                  'Em despesas, cada linha iniciada deve ter valor maior que zero e centro de custo, ou limpe/remova campos incompletos.',
                );
                return;
              }
              if (completeRows.length > 0) {
                expenseDetailPayload = completeRows.map((r) => {
                  const amt = parseFloat(r.amount.trim().replace(',', '.'));
                  const rounded = Math.round((Number.isFinite(amt) ? amt : 0) * 100) / 100;
                  const nt = r.notes.trim();
                  return {
                    amount: rounded,
                    notes: nt !== '' ? nt : null,
                    referentialAccountId: r.referentialAccountId.trim(),
                    ...(r.cashMovementId?.trim() ? { cashMovementId: r.cashMovementId.trim() } : {}),
                  };
                });
              }
            }

            let expenseTotalFromLines: number | null = null;
            if (expenseDetailPayload?.length) {
              expenseTotalFromLines = expenseDetailPayload.reduce((a, b) => a + b.amount, 0);
              expenseTotalFromLines = Math.round(expenseTotalFromLines * 100) / 100;
            }

            for (const key of mergedKeys) {
              if (key === 'EXPENSE' && expenseTotalFromLines != null) {
                closingByMethod[key] = expenseTotalFromLines;
                continue;
              }
              if (key === 'EXPENSE' && expenseTotalFromLines == null) {
                const raw = (draft[key] ?? '').trim();
                if (raw === '') {
                  setErr('Informe o total em Despesas ou grave ao menos uma linha detalhada com valor e centro.');
                  return;
                }
                const n = parseFloat(raw.replace(',', '.'));
                if (!Number.isFinite(n) || n < 0) {
                  setErr('Valor inválido em Despesas.');
                  return;
                }
                closingByMethod[key] = Math.round(n * 100) / 100;
                continue;
              }
              const raw = (draft[key] ?? '').trim();
              if (raw === '') continue;
              const n = parseFloat(raw.replace(',', '.'));
              if (!Number.isFinite(n) || n < 0) {
                setErr(`Valor inválido em ${PAYMENT_LABELS[key] ?? key}.`);
                return;
              }
              closingByMethod[key] = Math.round(n * 100) / 100;
            }
            if (Object.keys(closingByMethod).length === 0) {
              setErr('Informe ao menos um valor nos apresentados (ou mantenha linhas já preenchidas).');
              return;
            }
            let reconciliationExpenseDetails: unknown | null | undefined = undefined;
            if (wantsExpenseBranch) {
              if (expenseDetailPayload?.length) {
                reconciliationExpenseDetails = expenseDetailPayload;
              } else {
                reconciliationExpenseDetails = null;
              }
            }
            setErr(null);
            patchDeclared.mutate({
              closingByMethod,
              reconciliationExpenseDetails,
            });
          }}
        >
          {patchDeclared.isPending ? 'Salvando…' : 'Salvar apresentados'}
        </button>
      </div>
      <div
        style={{
          marginTop: '0.85rem',
          paddingTop: '0.85rem',
          borderTop: '1px solid var(--color-border-strong)',
        }}
      >
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
          Notas da conferência (opcional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Ex.: diferença em cartão conferida com o fecho da maquineta…"
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '0.85rem',
            borderRadius: 6,
            border: '1px solid var(--color-border-strong)',
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: '0.6rem' }}
          disabled={reconcile.isPending}
          onClick={() => {
            if (
              !confirm(
                'Confirmar que este caixa foi conferido e encerrado pela conferência do gerente?',
              )
            ) {
              return;
            }
            setErr(null);
            reconcile.mutate();
          }}
        >
          {reconcile.isPending ? 'Registrando…' : 'Marcar como conferido e fechado'}
        </button>
      </div>
    </div>
  );
}

function SessionDetailDrawer({
  detail,
  loading,
  error,
  onClose,
  onOpenMovement,
  onRefresh,
}: {
  detail: SessionDetail | undefined;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onOpenMovement: (id: string) => void;
  onRefresh: () => void;
}) {
  const s = detail?.session;
  const sales = detail?.sales ?? [];
  const sum = detail?.summary;
  const [expandedSale, setExpandedSale] = useState<string | null>(null);

  return (
    <div className="pos-history-drawer" role="presentation" onClick={onClose}>
      <div
        className="pos-history-panel"
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 100%)' }}
      >
        <div className="pos-history-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
              Detalhe do caixa{' '}
              {s && (
                <span
                  style={{
                    marginLeft: '0.4rem',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    fontSize: '0.95rem',
                    color: 'var(--color-primary, #1d4ed8)',
                  }}
                >
                  #{s.controlNumber}
                </span>
              )}
            </h2>
            <button type="button" className="pos-btn pos-btn-ghost" onClick={onClose}>
              Fechar
            </button>
          </div>
          {s && (
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
              Operador: <strong style={{ color: 'var(--color-text)' }}>{s.user?.name ?? '—'}</strong>
              {' · '}
              Status:{' '}
              <strong style={{ color: s.status === 'OPEN' ? '#15803d' : '#64748b' }}>
                {s.status === 'OPEN' ? 'Aberto' : 'Fechado'}
              </strong>
              <span
                style={{
                  marginLeft: '0.6rem',
                  fontSize: '0.72rem',
                  color: 'var(--color-text-muted)',
                  fontFamily: 'ui-monospace, monospace',
                }}
                title="Identificador único"
              >
                ID {s.id.slice(0, 8)}…
              </span>
            </div>
          )}
        </div>

        <div className="pos-history-list" style={{ padding: '1rem 1.25rem' }}>
          {loading && <div className="pos-items-empty">Carregando…</div>}
          {error && <div className="alert alert-error">{error}</div>}
          {!loading && !error && s && sum && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem', marginBottom: '1rem' }}>
                <KpiCard label="Aberto em" value={fmtDateTime(s.openedAt)} small />
                <KpiCard label="Fechado em" value={fmtDateTime(s.closedAt)} small />
                <KpiCard label="Vendas concluídas" value={String(sum.completedCount)} />
                <KpiCard label="Total vendido" value={formatBRL(sum.totalCompleted)} highlight />
                {sum.totalDiscounts > 0 ? (
                  <KpiCard label="Descontos concedidos" value={formatBRL(sum.totalDiscounts)} />
                ) : null}
                <KpiCard label="Itens vendidos" value={String(sum.itemsCount)} />
                <KpiCard label="Vendas canceladas" value={String(sum.cancelledCount)} small />
                <KpiCard label="Saldo inicial" value={formatBRL(s.openingBalance)} />
                {s.closingBalance && (
                  <KpiCard
                    label="Apresentado (meios)"
                    value={formatBRL(s.closingBalance)}
                    highlight
                  />
                )}
              </div>

              <PaymentReconciliation
                session={s}
                expected={sum.byMethod}
                movementBreakdown={sum.movementBreakdown}
              />

              <ManagerCashReconciliation
                session={s}
                expected={sum.byMethod}
                movementBreakdown={sum.movementBreakdown}
                onUpdated={onRefresh}
              />

              {s.closingNotes && (
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <strong style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>
                    Observações do operador no fechamento
                  </strong>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {s.closingNotes}
                  </p>
                </div>
              )}

              {/* Sangrias / suprimentos */}
              {s.movements.length > 0 && (
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <strong style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.88rem' }}>
                    Suprimentos, sangrias e despesas
                  </strong>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th>Forma</th>
                        <th style={{ textAlign: 'right' }}>Valor</th>
                        <th>Centro de custo</th>
                        <th>Observações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.movements.map((m) => (
                        <tr key={m.id}>
                          <td style={{ fontSize: '0.82rem' }}>{fmtDateTime(m.createdAt)}</td>
                          <td>
                            <span
                              style={{
                                padding: '0.1rem 0.5rem',
                                borderRadius: '999px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                background: m.type === 'IN' ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)',
                                color: m.type === 'IN' ? '#15803d' : '#b91c1c',
                              }}
                            >
                              {m.type === 'IN'
                                ? 'Suprimento'
                                : m.method === 'EXPENSE'
                                  ? 'Despesa'
                                  : 'Sangria'}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.8rem' }}>
                            {m.method ? PAYMENT_LABELS[m.method] ?? m.method : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {formatBRL(m.amount)}
                          </td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                            {m.referentialAccount
                              ? `${m.referentialAccount.code} — ${m.referentialAccount.description}`
                              : '—'}
                          </td>
                          <td style={{ fontSize: '0.82rem' }}>{m.reason ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <strong style={{ display: 'block', margin: '0.5rem 0 0.5rem', fontSize: '0.9rem' }}>
                Vendas realizadas ({sales.length})
              </strong>

              {sales.length === 0 ? (
                <div className="pos-items-empty">Nenhuma venda no período.</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>#</th>
                      <th>Data</th>
                      <th>Cliente</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((sale) => {
                      const expanded = expandedSale === sale.id;
                      return (
                        <Fragment key={sale.id}>
                          <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedSale(expanded ? null : sale.id)}>
                            <td><strong>#{sale.number}</strong></td>
                            <td style={{ fontSize: '0.82rem' }}>{fmtDateTime(sale.createdAt)}</td>
                            <td>{sale.customer?.name ?? 'Balcão'}</td>
                            <td>
                              <span
                                style={{
                                  padding: '0.1rem 0.5rem',
                                  borderRadius: '999px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  background:
                                    sale.status === 'COMPLETED'
                                      ? 'rgba(22,163,74,0.12)'
                                      : sale.status === 'CANCELLED'
                                        ? 'rgba(220,38,38,0.12)'
                                        : 'rgba(245,158,11,0.12)',
                                  color:
                                    sale.status === 'COMPLETED'
                                      ? '#15803d'
                                      : sale.status === 'CANCELLED'
                                        ? '#b91c1c'
                                        : '#b45309',
                                }}
                              >
                                {sale.status === 'COMPLETED' ? 'Concluída' : sale.status === 'CANCELLED' ? 'Cancelada' : 'Rascunho'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatBRL(sale.total)}</td>
                            <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{expanded ? '▾' : '▸'}</td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={6} style={{ background: 'var(--color-surface-elevated)', padding: '0.85rem 1.1rem' }}>
                                <strong style={{ fontSize: '0.82rem', display: 'block', marginBottom: '0.4rem' }}>
                                  Itens vendidos
                                </strong>
                                <table className="data-table" style={{ background: 'var(--color-surface)' }}>
                                  <thead>
                                    <tr>
                                      <th>Produto</th>
                                      <th>Descrição</th>
                                      <th style={{ textAlign: 'right' }}>Qtd</th>
                                      <th style={{ textAlign: 'right' }}>Preço venda</th>
                                      <th style={{ textAlign: 'right' }}>Unit. praticado</th>
                                      <th style={{ textAlign: 'right' }}>Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sale.items.map((it) => {
                                      const list = Number(it.variant.retailPrice ?? 0);
                                      const paid = Number(it.unitPrice ?? 0);
                                      const delta = paid - list;
                                      const showDelta = Math.abs(delta) > 0.005;
                                      return (
                                        <tr key={it.id}>
                                          <td>
                                            <strong>{it.variant.product.name}</strong>
                                            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                              SKU {it.variant.sku}
                                              {it.variant.barcode ? ` · EAN ${it.variant.barcode}` : ''}
                                            </span>
                                          </td>
                                          <td style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', maxWidth: 280 }}>
                                            {it.variant.product.description ?? '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                            {Number(it.quantity).toLocaleString('pt-BR')}
                                          </td>
                                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)' }}>
                                            {formatBRL(it.variant.retailPrice)}
                                          </td>
                                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                            <strong>{formatBRL(it.unitPrice)}</strong>
                                            {showDelta && (
                                              <div
                                                style={{
                                                  fontSize: '0.7rem',
                                                  color: delta < 0 ? '#b91c1c' : '#15803d',
                                                }}
                                              >
                                                {delta < 0 ? '▼' : '▲'} {formatBRL(Math.abs(delta))}
                                              </div>
                                            )}
                                          </td>
                                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                            {formatBRL(it.totalLine)}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                                {sale.payments.length > 0 && (
                                  <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                    {sale.payments.map((p, i) => (
                                      <span
                                        key={i}
                                        style={{
                                          padding: '0.15rem 0.55rem',
                                          borderRadius: '999px',
                                          background: 'var(--color-primary-muted)',
                                          color: 'var(--color-primary)',
                                          fontSize: '0.78rem',
                                          fontWeight: 600,
                                        }}
                                      >
                                        {PAYMENT_LABELS[p.method] ?? p.method}
                                        {p.installments > 1 ? ` ${p.installments}×` : ''}: {formatBRL(p.amount)}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {s.status === 'OPEN' && (
                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onOpenMovement(s.id)}
                  >
                    Lançar movimento (sangria / despesa / suprimento)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compara o esperado (apurado via vendas concluídas) com o declarado (o que
 * o operador disse ter em mãos no fechamento). Quando a sessão ainda está
 * aberta ou o operador não informou o breakdown, mostramos apenas o esperado.
 */
function PaymentReconciliation({
  session,
  expected,
  movementBreakdown,
}: {
  session: SessionDetail['session'];
  expected: Record<string, number>;
  movementBreakdown?: CashMovementBreakdown;
}) {
  const declared = session.closingByMethod ?? null;
  const visible = buildCashReconciliationRows(session, expected);
  if (visible.length === 0) return null;

  const opening = parseFloat(session.openingBalance) || 0;

  const { totalExpected, totalDeclared } = sumReconciliationTotals(visible, false);
  const totalDiff = declared ? totalDeclared - totalExpected : null;

  const reconExpenseLines =
    Array.isArray(session.reconciliationExpenseDetails) && session.reconciliationExpenseDetails.length
      ? session.reconciliationExpenseDetails
      : null;

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '0.85rem 1rem 0.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: '0.92rem' }}>Conciliação por forma de pagamento</strong>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
          {session.reconciledAt
            ? 'Conferência registrada — valores conferidos pelo gerente'
            : declared
              ? 'Esperado × Declarado pelo operador'
              : 'Esperado (caixa ainda não fechado)'}
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Forma</th>
            <th style={{ textAlign: 'right' }}>Esperado</th>
            <th style={{ textAlign: 'right' }}>Declarado</th>
            <th style={{ textAlign: 'right' }}>Diferença</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const label = PAYMENT_LABELS[r.key] ?? r.key;
            const diffClass =
              r.diff == null
                ? ''
                : Math.abs(r.diff) < 0.005
                  ? 'is-ok'
                  : r.diff > 0
                    ? 'is-over'
                    : 'is-short';
            return (
              <Fragment key={r.key}>
                <tr>
                  <td>
                    <strong>{label}</strong>
                    {r.key === 'CASH' && (
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                        {formatCashExpectedHint(opening, movementBreakdown)}
                      </span>
                    )}
                    {r.key === 'EXPENSE' && (
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                        analítico — não entra no total apresentado
                        {reconExpenseLines ? ' · detalhes abaixo' : ''}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatBRL(r.expectedFinal)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.declaredVal == null ? '—' : formatBRL(r.declaredVal)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 700,
                    }}
                  >
                    {r.diff == null ? (
                      '—'
                    ) : (
                      <span
                        style={{
                          padding: '0.15rem 0.55rem',
                          borderRadius: '999px',
                          background:
                            diffClass === 'is-ok'
                              ? 'rgba(22,163,74,0.12)'
                              : diffClass === 'is-over'
                                ? 'rgba(37,99,235,0.12)'
                                : 'rgba(220,38,38,0.12)',
                          color:
                            diffClass === 'is-ok'
                              ? '#15803d'
                              : diffClass === 'is-over'
                                ? '#1d4ed8'
                                : '#b91c1c',
                          fontSize: '0.85rem',
                        }}
                      >
                        {Math.abs(r.diff) < 0.005
                          ? 'OK'
                          : (r.diff > 0 ? '+' : '') + formatBRL(r.diff)}
                      </span>
                    )}
                  </td>
                </tr>
                {r.key === 'EXPENSE' && reconExpenseLines
                  ? reconExpenseLines.map((line, ix) => {
                      const cc = line.referentialAccount
                        ? `${line.referentialAccount.code} — ${line.referentialAccount.description}`
                        : line.referentialAccountId
                          ? `Conta (${line.referentialAccountId.slice(0, 8)}…)`
                          : '—';
                      const amt =
                        typeof line.amount === 'number' && Number.isFinite(line.amount)
                          ? line.amount
                          : parseFloat(String(line.amount ?? '').replace(',', '.'));
                      return (
                        <tr key={`${r.key}-recon-detail-${ix}`}>
                          <td
                            colSpan={4}
                            style={{
                              background: 'var(--color-surface-elevated)',
                              padding: '0.4rem 0.85rem',
                              borderTop: '1px dashed var(--color-border-strong)',
                              fontSize: '0.78rem',
                            }}
                          >
                            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {formatBRL(amt)}
                            </strong>
                            <span style={{ color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>· {cc}</span>
                            {line.notes ? (
                              <span
                                style={{
                                  display: 'block',
                                  marginTop: '0.2rem',
                                  color: 'var(--color-text-secondary)',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {line.notes}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--color-surface-elevated)' }}>
            <td style={{ fontWeight: 800 }}>
              Total (meios)
              <span
                style={{
                  display: 'block',
                  fontSize: '0.68rem',
                  fontWeight: 500,
                  color: 'var(--color-text-muted)',
                }}
              >
                sem linha de despesas
              </span>
            </td>
            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>
              {formatBRL(totalExpected)}
            </td>
            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>
              {declared ? formatBRL(totalDeclared) : '—'}
            </td>
            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>
              {totalDiff == null
                ? '—'
                : (totalDiff > 0 ? '+' : '') + formatBRL(totalDiff)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function KpiCard({ label, value, highlight, small }: { label: string; value: string; highlight?: boolean; small?: boolean }) {
  return (
    <div
      className="card"
      style={{
        padding: '0.65rem 0.85rem',
        background: highlight ? 'var(--color-primary-muted)' : 'var(--color-surface)',
      }}
    >
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: small ? '0.85rem' : '1.05rem',
          fontWeight: 700,
          color: highlight ? 'var(--color-primary)' : 'var(--color-text)',
          fontVariantNumeric: 'tabular-nums',
          marginTop: '0.15rem',
        }}
      >
        {value}
      </div>
    </div>
  );
}
