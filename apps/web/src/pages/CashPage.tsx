import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isManager } from '../lib/auth';
import { formatBRL } from '../lib/format';

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
  openedAt: string;
  closedAt: string | null;
  userId: string;
  user: CashUser | null;
  movementsIn: number;
  movementsOut: number;
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
      reason: string | null;
      createdAt: string;
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
    byMethod: Record<string, number>;
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
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
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
    mutationFn: () =>
      api('/cash/movement', {
        method: 'POST',
        json: {
          type: movType,
          amount: parseFloat(movAmount.replace(',', '.')) || 0,
          reason: movReason || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash', 'sessions'] });
      qc.invalidateQueries({ queryKey: ['cash', 'session'] });
      setMovAmount('');
      setMovReason('');
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
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Controle</th>
                  <th>Operador</th>
                  <th>Status</th>
                  <th>Aberto em</th>
                  <th>Fechado em</th>
                  <th style={{ textAlign: 'right' }}>Saldo inicial</th>
                  <th style={{ textAlign: 'right' }}>Suprim. / Sangrias</th>
                  <th style={{ textAlign: 'right' }}>Saldo final</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                      Nenhum caixa encontrado para este filtro.
                    </td>
                  </tr>
                )}
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.1rem 0.5rem',
                          background: 'var(--color-surface-elevated)',
                          border: '1px solid var(--color-border-strong)',
                          borderRadius: 6,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                        }}
                        title={`ID: ${s.id}`}
                      >
                        #{s.controlNumber}
                      </span>
                    </td>
                    <td>
                      <strong>{s.user?.name ?? '—'}</strong>
                      <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                        {s.user?.email ?? ''}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          padding: '0.15rem 0.55rem',
                          borderRadius: '999px',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          background: s.status === 'OPEN' ? 'rgba(22,163,74,0.12)' : 'rgba(148,163,184,0.18)',
                          color: s.status === 'OPEN' ? '#15803d' : '#64748b',
                        }}
                      >
                        {s.status === 'OPEN' ? '● Aberto' : 'Fechado'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{fmtDateTime(s.openedAt)}</td>
                    <td style={{ fontSize: '0.85rem' }}>{fmtDateTime(s.closedAt)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatBRL(s.openingBalance)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem' }}>
                      <span style={{ color: '#15803d' }}>+{formatBRL(s.movementsIn)}</span>
                      <br />
                      <span style={{ color: '#b91c1c' }}>−{formatBRL(s.movementsOut)}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {s.closingBalance ? formatBRL(s.closingBalance) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '0.3rem 0.65rem', fontSize: '0.82rem' }}
                        onClick={() => setDetailId(s.id)}
                      >
                        Ver detalhes
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
          onOpenMovement={(sessionId) => {
            setMovOpenForId(sessionId);
            setMovType('OUT');
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
              Lance sangria (saída) ou suprimento (entrada) no seu caixa atual.
              Operadores só podem movimentar o próprio caixa.
            </p>
            {movErr && <div className="alert alert-error">{movErr}</div>}
            <div className="form-row">
              <div className="field">
                <label>Tipo</label>
                <select value={movType} onChange={(e) => setMovType(e.target.value as 'IN' | 'OUT')}>
                  <option value="OUT">Saída (sangria)</option>
                  <option value="IN">Entrada (suprimento)</option>
                </select>
              </div>
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
            <div className="field">
              <label>Motivo</label>
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

function SessionDetailDrawer({
  detail,
  loading,
  error,
  onClose,
  onOpenMovement,
}: {
  detail: SessionDetail | undefined;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onOpenMovement: (id: string) => void;
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
                <KpiCard label="Itens vendidos" value={String(sum.itemsCount)} />
                <KpiCard label="Vendas canceladas" value={String(sum.cancelledCount)} small />
                <KpiCard label="Saldo inicial" value={formatBRL(s.openingBalance)} />
                {s.closingBalance && <KpiCard label="Saldo final" value={formatBRL(s.closingBalance)} highlight />}
              </div>

              <PaymentReconciliation
                session={s}
                expected={sum.byMethod}
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
                    Suprimentos e sangrias
                  </strong>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th style={{ textAlign: 'right' }}>Valor</th>
                        <th>Motivo</th>
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
                              {m.type === 'IN' ? 'Suprimento' : 'Sangria'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {formatBRL(m.amount)}
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
                    Lançar sangria / suprimento
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
}: {
  session: SessionDetail['session'];
  expected: Record<string, number>;
}) {
  const declared = session.closingByMethod ?? null;
  const methodKeys = Array.from(
    new Set([
      ...Object.keys(expected),
      ...Object.keys(declared ?? {}),
      // Dinheiro merece estar sempre presente para conferência do fundo.
      'CASH',
    ]),
  );
  if (methodKeys.length === 0) return null;

  const opening = parseFloat(session.openingBalance) || 0;

  const rows = methodKeys.map((key) => {
    const baseExpected = expected[key] ?? 0;
    // Para o caixa em dinheiro, o esperado real considera o fundo + vendas em dinheiro.
    const expectedFinal = key === 'CASH' ? baseExpected + opening : baseExpected;
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

  // Esconde linhas totalmente zeradas (sem esperado e sem declarado).
  const visible = rows.filter((r) => r.expectedFinal > 0 || r.declaredVal != null);

  if (visible.length === 0) return null;

  const totalExpected = visible.reduce((s, r) => s + r.expectedFinal, 0);
  const totalDeclared = visible.reduce((s, r) => s + (r.declaredVal ?? 0), 0);
  const totalDiff = declared ? totalDeclared - totalExpected : null;

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '0.85rem 1rem 0.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: '0.92rem' }}>Conciliação por forma de pagamento</strong>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
          {declared ? 'Esperado × Declarado pelo operador' : 'Esperado (caixa ainda não fechado)'}
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
              <tr key={r.key}>
                <td>
                  <strong>{label}</strong>
                  {r.key === 'CASH' && opening > 0 && (
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                      inclui fundo de {formatBRL(opening)}
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
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--color-surface-elevated)' }}>
            <td style={{ fontWeight: 800 }}>Total</td>
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
