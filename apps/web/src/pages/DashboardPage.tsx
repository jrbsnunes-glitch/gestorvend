import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { BillPaymentsButton } from '../components/BillSettlementsModal';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { SalesMonthChart } from '../components/SalesMonthChart';
import { api } from '../lib/api';
import { companyDisplayName, useCompanyBranding } from '../lib/company-branding';
import { isManager } from '../lib/auth';
import { formatBRL, formatDate } from '../lib/format';
import {
  buildCurrentMonthAxisThroughToday,
  currentMonthKey,
  mergeTrendIntoMonthAxis,
} from '../lib/month-sales-chart';
import { buildProductTurnoverLastDaysPath } from '../lib/product-report-format';

const DASH_PREVIEW_LIMIT = 5;
const DASH_TOP_PRODUCTS_LIMIT = 3;

type DashPanelKey = 'lowStock' | 'payables' | 'receivables';

type Overview = {
  revenue: {
    today: number;
    month: number;
    receivedToday: number;
    deferredToday: number;
    receivedMonth: number;
    deferredMonth: number;
  };
  sales: { today: number; month: number; avgTicketMonth: number };
  salesTrendMonth: Array<{ date: string; revenue: number; count: number }>;
  topProducts: Array<{
    variantId: string;
    sku: string;
    productName: string;
    quantity: number;
    total: number;
  }>;
  lowStock: Array<{
    variantId: string;
    sku: string;
    productName: string;
    minStock: number;
    onHand: number;
  }>;
  openSessions: Array<{
    id: string;
    controlNumber: number;
    operator: string;
    openedAt: string;
    openingBalance: number;
  }>;
  payablesSoon: Array<{
    id: string;
    description: string;
    status: string;
    amount: number;
    amountRemaining: number;
    dueDate: string;
    supplier: string | null;
  }>;
  receivablesSoon: Array<{
    id: string;
    description: string;
    status: string;
    amount: number;
    amountRemaining: number;
    dueDate: string;
    customer: string | null;
  }>;
};

function daysUntilDue(dueDate: string): number {
  const d = new Date(dueDate);
  const today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function isDueDatePast(dueDate: string): boolean {
  return daysUntilDue(dueDate) < 0;
}

function dueDaysBadge(status: string, dueDate: string): ReactNode {
  const days = daysUntilDue(dueDate);
  const overdue = status === 'OVERDUE' || days < 0;
  if (overdue) {
    const ago = Math.abs(days);
    const label = ago === 0 ? 'Vence hoje' : ago === 1 ? 'Vencido há 1 dia' : `Vencido há ${ago} dias`;
    return (
      <span className="dash-due-badge dash-due-badge--overdue" title={`Vencimento: ${formatDate(dueDate)}`}>
        {label}
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="dash-due-badge dash-due-badge--today" title={`Vencimento: ${formatDate(dueDate)}`}>
        Vence hoje
      </span>
    );
  }
  if (days === 1) {
    return (
      <span className="dash-due-badge dash-due-badge--soon" title={`Vencimento: ${formatDate(dueDate)}`}>
        Vence amanhã
      </span>
    );
  }
  if (days <= 7) {
    return (
      <span className="dash-due-badge dash-due-badge--soon" title={`Vencimento: ${formatDate(dueDate)}`}>
        Vence em {days} dias
      </span>
    );
  }
  return null;
}

function dueLabelShort(status: string, dueDate: string): string {
  if (status === 'OVERDUE' || isDueDatePast(dueDate)) {
    return `venceu em ${formatDate(dueDate)}`;
  }
  return `vence em ${formatDate(dueDate)}`;
}

function previewItems<T>(items: T[]): T[] {
  return items.slice(0, DASH_PREVIEW_LIMIT);
}

function DashSeeMoreButton({ total, onClick }: { total: number; onClick: () => void }) {
  if (total <= DASH_PREVIEW_LIMIT) return null;
  return (
    <div className="dash-block-more">
      <button type="button" className="btn btn-secondary btn-compact" onClick={onClick}>
        Ver mais ({total - DASH_PREVIEW_LIMIT} restantes)
      </button>
    </div>
  );
}

function TopProductsHeroTable({ items }: { items: Overview['topProducts'] }) {
  const top3 = items.slice(0, DASH_TOP_PRODUCTS_LIMIT);
  return (
    <table className="dash-top-hero-table">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Produto</th>
          <th className="num">Qtd</th>
          <th className="num">Valor</th>
        </tr>
      </thead>
      <tbody>
        {top3.map((p, idx) => (
          <tr key={p.variantId}>
            <td className="num">{idx + 1}</td>
            <td>
              <span className="dash-top-hero-name">{p.productName}</span>
            </td>
            <td className="num">{p.quantity.toLocaleString('pt-BR')}</td>
            <td className="num">{formatBRL(p.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LowStockTable({
  items,
  compact,
}: {
  items: Overview['lowStock'];
  compact?: boolean;
}) {
  return (
    <table className={`data-table${compact ? ' dash-block-table' : ''}`}>
      <thead>
        <tr>
          <th className="num" style={{ width: '3rem' }}>
            #
          </th>
          <th>Produto</th>
          <th style={{ textAlign: 'right' }}>Saldo</th>
          <th style={{ textAlign: 'right' }}>Mínimo</th>
        </tr>
      </thead>
      <tbody>
        {items.map((row, idx) => (
          <tr key={row.variantId}>
            <td className="num">{idx + 1}</td>
            <td>
              <strong>{row.productName}</strong>
              <div className="dash-cell-sub">SKU {row.sku}</div>
            </td>
            <td
              className="num"
              style={{ color: row.onHand <= 0 ? '#b91c1c' : '#b45309', fontWeight: 700 }}
            >
              {row.onHand.toLocaleString('pt-BR')}
            </td>
            <td className="num dash-cell-muted">{row.minStock.toLocaleString('pt-BR')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PayablesList({ items }: { items: Overview['payablesSoon'] }) {
  return (
    <ul className="dash-list">
      {items.map((p) => (
        <li key={p.id}>
          <div>
            <div className="dash-list-title-row">
              <strong>{p.description}</strong>
              {dueDaysBadge(p.status, p.dueDate)}
            </div>
            <div className="dash-list-meta">
              {p.supplier ?? '—'} · {dueLabelShort(p.status, p.dueDate)}
              {p.amountRemaining < p.amount - 0.005 ? <span> · face {formatBRL(p.amount)}</span> : null}
            </div>
            {p.amountRemaining < p.amount - 0.005 ? (
              <div className="no-print" style={{ marginTop: '0.35rem' }}>
                <BillPaymentsButton kind="pagar" billId={p.id} description={p.description} />
              </div>
            ) : null}
          </div>
          <strong className="dash-list-amt">{formatBRL(p.amountRemaining)}</strong>
        </li>
      ))}
    </ul>
  );
}

function ReceivablesList({ items }: { items: Overview['receivablesSoon'] }) {
  return (
    <ul className="dash-list">
      {items.map((r) => (
        <li key={r.id}>
          <div>
            <div className="dash-list-title-row">
              <strong>{r.description}</strong>
              {dueDaysBadge(r.status, r.dueDate)}
            </div>
            <div className="dash-list-meta">
              {r.customer ?? '—'} · {dueLabelShort(r.status, r.dueDate)}
              {r.amountRemaining < r.amount - 0.005 ? <span> · face {formatBRL(r.amount)}</span> : null}
            </div>
            {r.amountRemaining < r.amount - 0.005 ? (
              <div className="no-print" style={{ marginTop: '0.35rem' }}>
                <BillPaymentsButton kind="receber" billId={r.id} description={r.description} />
              </div>
            ) : null}
          </div>
          <strong className="dash-list-amt" style={{ color: '#15803d' }}>
            {formatBRL(r.amountRemaining)}
          </strong>
        </li>
      ))}
    </ul>
  );
}

const PANEL_MODAL_TITLES: Record<DashPanelKey, string> = {
  lowStock: 'Estoque crítico',
  payables: 'Contas a pagar (vencidos e até 7 dias)',
  receivables: 'Contas a receber (vencidos e até 7 dias)',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const company = useCompanyBranding();
  const showMonthRevenue = isManager();
  const [expandedPanel, setExpandedPanel] = useState<DashPanelKey | null>(null);
  const turnoverReportPath = buildProductTurnoverLastDaysPath(30, '/');
  const overview = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => api<Overview>('/dashboard/overview'),
    staleTime: 60_000,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? false
        : 120_000,
  });

  const data = overview.data;

  const monthKey = currentMonthKey();
  const monthAxis = useMemo(() => buildCurrentMonthAxisThroughToday(), [monthKey]);

  const salesTrendMonth = useQuery({
    queryKey: ['dashboard', 'sales-trend-month', monthKey],
    queryFn: async () => {
      const res = await api<{ points: Overview['salesTrendMonth'] }>('/dashboard/sales-trend-month');
      return res.points;
    },
    staleTime: 60_000,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? false
        : 120_000,
  });

  const salesTrendPoints = useMemo(
    () => mergeTrendIntoMonthAxis(monthAxis, salesTrendMonth.data ?? data?.salesTrendMonth),
    [monthAxis, salesTrendMonth.data, data?.salesTrendMonth],
  );

  const salesTrendLoading =
    overview.isLoading &&
    salesTrendMonth.isLoading &&
    !salesTrendMonth.data &&
    !(data?.salesTrendMonth?.length ?? 0);

  const topProducts = data?.topProducts ?? [];
  const lowStock = data?.lowStock ?? [];
  const payablesSoon = data?.payablesSoon ?? [];
  const receivablesSoon = data?.receivablesSoon ?? [];
  const openSessions = data?.openSessions ?? [];

  function openTurnoverReport() {
    navigate(turnoverReportPath);
  }

  function renderExpandedPanel() {
    if (!expandedPanel || !data) return null;
    switch (expandedPanel) {
      case 'lowStock':
        return <LowStockTable items={lowStock} />;
      case 'payables':
        return <PayablesList items={payablesSoon} />;
      case 'receivables':
        return <ReceivablesList items={receivablesSoon} />;
    }
  }

  return (
    <div className="page dashboard-page">
      <header className="company-page-head">
        <CompanyLogo className="company-page-head__logo" company={company.data ?? null} />
        <div className="company-page-head__text">
          <h1 className="page-title">Início</h1>
          <p className="page-desc">Resumo do dia e da operação.</p>
          {company.data ? (
            <p className="company-page-head__store">{companyDisplayName(company.data)}</p>
          ) : null}
        </div>
      </header>

      {overview.isError && (
        <div className="alert alert-error">
          {(overview.error as Error)?.message ?? 'Erro ao carregar o painel.'}
        </div>
      )}

      <section className="dash-hero">
        <article className="dash-hero-card dash-hero-today">
          <span className="dash-hero-label">Faturamento de hoje</span>
          <strong className="dash-hero-value">
            {overview.isLoading ? '…' : formatBRL(data?.revenue.today ?? 0)}
          </strong>
          <span className="dash-hero-foot">
            {data?.sales.today ?? 0} venda(s) concluída(s)
          </span>
          {!overview.isLoading ? (
            <span className="dash-hero-split">
              Recebido no caixa: <strong>{formatBRL(data?.revenue.receivedToday ?? 0)}</strong>
              {(data?.revenue.deferredToday ?? 0) > 0 ? (
                <>
                  {' '}
                  · A prazo (crediário/requisição):{' '}
                  <strong>{formatBRL(data?.revenue.deferredToday ?? 0)}</strong>
                </>
              ) : null}
            </span>
          ) : null}
        </article>
        {showMonthRevenue && (
          <article className="dash-hero-card dash-hero-month">
            <span className="dash-hero-label">Faturamento do mês</span>
            <strong className="dash-hero-value">
              {overview.isLoading ? '…' : formatBRL(data?.revenue.month ?? 0)}
            </strong>
            <span className="dash-hero-foot">
              {data?.sales.month ?? 0} venda(s) · ticket médio{' '}
              <strong>{formatBRL(data?.sales.avgTicketMonth ?? 0)}</strong>
            </span>
            {!overview.isLoading ? (
              <span className="dash-hero-split">
                Recebido no caixa: <strong>{formatBRL(data?.revenue.receivedMonth ?? 0)}</strong>
                {(data?.revenue.deferredMonth ?? 0) > 0 ? (
                  <>
                    {' '}
                    · A prazo: <strong>{formatBRL(data?.revenue.deferredMonth ?? 0)}</strong>
                  </>
                ) : null}
              </span>
            ) : null}
          </article>
        )}
        <article
          className="dash-hero-card dash-hero-topproducts"
          role="button"
          tabIndex={0}
          title="Abrir relatório de giro dos últimos 30 dias"
          onClick={openTurnoverReport}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openTurnoverReport();
            }
          }}
        >
          <span className="dash-hero-label">Top produtos (últimos 30 dias)</span>
          {overview.isLoading ? (
            <span className="dash-hero-foot">Carregando…</span>
          ) : !topProducts.length ? (
            <span className="dash-hero-foot">Ainda sem vendas no período.</span>
          ) : (
            <>
              <TopProductsHeroTable items={topProducts} />
              <span className="dash-hero-split dash-hero-topproducts-hint">
                {topProducts.length < DASH_TOP_PRODUCTS_LIMIT
                  ? `${topProducts.length} produto(s) com venda no período · `
                  : null}
                Clique para gerar o relatório de giro →
              </span>
            </>
          )}
        </article>
      </section>

      <section className="dash-grid dash-grid--row2">
        <article className="card dash-block dash-block--payables">
          <header className="dash-block-head">
            <h2>Contas a pagar</h2>
            <Link to="/financeiro?tab=pagar" className="dash-block-link">
              Financeiro →
            </Link>
          </header>
          <p className="dash-block-sub">Vencidos e até 7 dias</p>
          {overview.isLoading && <p className="dash-empty">Carregando…</p>}
          {!overview.isLoading && !payablesSoon.length && (
            <p className="dash-empty">Sem títulos vencidos ou a vencer nos próximos 7 dias.</p>
          )}
          {payablesSoon.length ? (
            <>
              <PayablesList items={previewItems(payablesSoon)} />
              <DashSeeMoreButton total={payablesSoon.length} onClick={() => setExpandedPanel('payables')} />
            </>
          ) : null}
        </article>

        <article className="card dash-block dash-block--receivables">
          <header className="dash-block-head">
            <h2>Contas a receber</h2>
            <Link to="/financeiro?tab=receber" className="dash-block-link">
              Financeiro →
            </Link>
          </header>
          <p className="dash-block-sub">Vencidos e até 7 dias</p>
          {overview.isLoading && <p className="dash-empty">Carregando…</p>}
          {!overview.isLoading && !receivablesSoon.length && (
            <p className="dash-empty">Sem títulos vencidos ou a receber nos próximos 7 dias.</p>
          )}
          {receivablesSoon.length ? (
            <>
              <ReceivablesList items={previewItems(receivablesSoon)} />
              <DashSeeMoreButton total={receivablesSoon.length} onClick={() => setExpandedPanel('receivables')} />
            </>
          ) : null}
        </article>

        <article className="card dash-block dash-block--lowstock">
          <header className="dash-block-head">
            <h2>Estoque crítico</h2>
            <Link to="/estoque/painel" className="dash-block-link">
              Ver estoque →
            </Link>
          </header>
          <p className="dash-block-sub">Saldo no ou abaixo do mínimo</p>
          {overview.isLoading && <p className="dash-empty">Carregando…</p>}
          {!overview.isLoading && !lowStock.length && (
            <p className="dash-empty">Nenhum produto abaixo do estoque mínimo.</p>
          )}
          {lowStock.length ? (
            <>
              <LowStockTable items={previewItems(lowStock)} compact />
              <DashSeeMoreButton total={lowStock.length} onClick={() => setExpandedPanel('lowStock')} />
            </>
          ) : null}
        </article>
      </section>

      <section className="dash-row-sessions">
        <article className="card dash-block dash-block--sessions">
          <header className="dash-block-head">
            <h2>Caixas abertos</h2>
            <Link to="/caixa" className="dash-block-link">
              Ver caixa →
            </Link>
          </header>
          <p className="dash-sessions-count">
            {overview.isLoading ? '…' : openSessions.length}
          </p>
          {!overview.isLoading && !openSessions.length ? (
            <p className="dash-empty">Nenhum operador em caixa no momento.</p>
          ) : null}
        </article>
      </section>

      <section className="dash-row-sales-chart">
        <article className="card dash-block dash-block--sales-trend">
          <header className="dash-block-head">
            <h2>Evolução de vendas no mês</h2>
          </header>
          <SalesMonthChart points={salesTrendPoints} loading={salesTrendLoading} />
        </article>
      </section>

      {expandedPanel && (
        <FormModalBackdrop className="modal-backdrop--wide" onClose={() => setExpandedPanel(null)}>
          <div
            className="modal modal--wide dash-panel-modal"
            role="dialog"
            aria-labelledby="dash-panel-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="dash-panel-modal-title">{PANEL_MODAL_TITLES[expandedPanel]}</h2>
            <p className="dash-panel-modal-count">
              {expandedPanel === 'lowStock' && `${lowStock.length} variação(ões) com estoque crítico`}
              {expandedPanel === 'payables' && `${payablesSoon.length} título(s) a pagar`}
              {expandedPanel === 'receivables' && `${receivablesSoon.length} título(s) a receber`}
            </p>
            <div className="dash-panel-modal-body">{renderExpandedPanel()}</div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setExpandedPanel(null)}>
                Fechar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}
    </div>
  );
}
