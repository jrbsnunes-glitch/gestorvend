import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { BillPaymentsButton } from '../components/BillSettlementsModal';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { api } from '../lib/api';
import { companyDisplayName, useCompanyBranding } from '../lib/company-branding';
import { formatBRL, formatDate } from '../lib/format';

const DASH_PREVIEW_LIMIT = 5;

type DashPanelKey = 'topProducts' | 'lowStock' | 'payables' | 'receivables';

type Overview = {
  revenue: { today: number; month: number };
  sales: { today: number; month: number; avgTicketMonth: number };
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

function TopProductsTable({
  items,
  compact,
}: {
  items: Overview['topProducts'];
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
          <th style={{ textAlign: 'right' }}>Qtd</th>
          <th style={{ textAlign: 'right' }}>Valor</th>
        </tr>
      </thead>
      <tbody>
        {items.map((p, idx) => (
          <tr key={p.variantId}>
            <td className="num">{idx + 1}</td>
            <td>
              <strong>{p.productName}</strong>
              <div className="dash-cell-sub">SKU {p.sku}</div>
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
  topProducts: 'Top produtos (últimos 30 dias)',
  lowStock: 'Estoque crítico',
  payables: 'A pagar (vencidos e até 7 dias)',
  receivables: 'A receber (vencidos e até 7 dias)',
};

export function DashboardPage() {
  const company = useCompanyBranding();
  const [expandedPanel, setExpandedPanel] = useState<DashPanelKey | null>(null);
  const overview = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => api<Overview>('/dashboard/overview'),
    refetchOnMount: 'always',
    refetchInterval: 60_000,
  });

  const data = overview.data;

  const topProducts = data?.topProducts ?? [];
  const lowStock = data?.lowStock ?? [];
  const payablesSoon = data?.payablesSoon ?? [];
  const receivablesSoon = data?.receivablesSoon ?? [];

  function renderExpandedPanel() {
    if (!expandedPanel || !data) return null;
    switch (expandedPanel) {
      case 'topProducts':
        return <TopProductsTable items={topProducts} />;
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
        </article>
        <article className="dash-hero-card dash-hero-month">
          <span className="dash-hero-label">Faturamento do mês</span>
          <strong className="dash-hero-value">
            {overview.isLoading ? '…' : formatBRL(data?.revenue.month ?? 0)}
          </strong>
          <span className="dash-hero-foot">
            {data?.sales.month ?? 0} venda(s) · ticket médio{' '}
            <strong>{formatBRL(data?.sales.avgTicketMonth ?? 0)}</strong>
          </span>
        </article>
        <article className="dash-hero-card dash-hero-sessions">
          <span className="dash-hero-label">Caixas abertos</span>
          <strong className="dash-hero-value">{data?.openSessions.length ?? 0}</strong>
          <span className="dash-hero-foot">
            {data?.openSessions.length
              ? data.openSessions
                  .slice(0, 2)
                  .map((s) => `${s.operator} (#${s.controlNumber})`)
                  .join(' · ')
              : 'Nenhum operador em caixa no momento.'}
          </span>
        </article>
      </section>

      <section className="dash-grid">
        <article className="card dash-block">
          <header className="dash-block-head">
            <h2>Top produtos (últimos 30 dias)</h2>
            <Link to="/produtos" className="dash-block-link">
              Ver produtos →
            </Link>
          </header>
          {overview.isLoading && <p className="dash-empty">Carregando…</p>}
          {!overview.isLoading && !topProducts.length && (
            <p className="dash-empty">Ainda sem vendas no período.</p>
          )}
          {topProducts.length ? (
            <>
              <TopProductsTable items={previewItems(topProducts)} compact />
              <DashSeeMoreButton total={topProducts.length} onClick={() => setExpandedPanel('topProducts')} />
            </>
          ) : null}
        </article>

        <article className="card dash-block">
          <header className="dash-block-head">
            <h2>Estoque crítico</h2>
            <Link to="/estoque/painel" className="dash-block-link">
              Ver estoque →
            </Link>
          </header>
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

        <article className="card dash-block">
          <header className="dash-block-head">
            <h2>A pagar (vencidos e até 7 dias)</h2>
            <Link to="/financeiro" className="dash-block-link">
              Financeiro →
            </Link>
          </header>
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

        <article className="card dash-block">
          <header className="dash-block-head">
            <h2>A receber (vencidos e até 7 dias)</h2>
            <Link to="/financeiro" className="dash-block-link">
              Financeiro →
            </Link>
          </header>
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
              {expandedPanel === 'topProducts' && `${topProducts.length} produto(s) no ranking`}
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
