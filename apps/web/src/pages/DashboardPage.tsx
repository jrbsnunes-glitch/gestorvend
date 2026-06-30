import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { api } from '../lib/api';
import { companyDisplayName, useCompanyBranding } from '../lib/company-branding';
import { formatBRL, formatDate } from '../lib/format';

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

export function DashboardPage() {
  const company = useCompanyBranding();
  const overview = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => api<Overview>('/dashboard/overview'),
    refetchOnMount: 'always',
    refetchInterval: 60_000,
  });

  const data = overview.data;

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
          {!overview.isLoading && !data?.topProducts.length && (
            <p className="dash-empty">Ainda sem vendas no período.</p>
          )}
          {data?.topProducts.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num" style={{ width: '3rem' }}>
                    Cont.
                  </th>
                  <th>Produto</th>
                  <th style={{ textAlign: 'right' }}>Qtd</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p, idx) => (
                  <tr key={p.variantId}>
                    <td className="num">{idx + 1}</td>
                    <td>
                      <strong>{p.productName}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>SKU {p.sku}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {p.quantity.toLocaleString('pt-BR')}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatBRL(p.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          {!overview.isLoading && !data?.lowStock.length && (
            <p className="dash-empty">Nenhum produto abaixo do estoque mínimo.</p>
          )}
          {data?.lowStock.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num" style={{ width: '3rem' }}>
                    Cont.
                  </th>
                  <th>Produto</th>
                  <th style={{ textAlign: 'right' }}>Saldo</th>
                  <th style={{ textAlign: 'right' }}>Mínimo</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStock.map((row, idx) => (
                  <tr key={row.variantId}>
                    <td className="num">{idx + 1}</td>
                    <td>
                      <strong>{row.productName}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>SKU {row.sku}</div>
                    </td>
                    <td style={{ textAlign: 'right', color: row.onHand <= 0 ? '#b91c1c' : '#b45309', fontWeight: 700 }}>
                      {row.onHand.toLocaleString('pt-BR')}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                      {row.minStock.toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          {!overview.isLoading && !data?.payablesSoon.length && (
            <p className="dash-empty">Sem títulos vencidos ou a vencer nos próximos 7 dias.</p>
          )}
          {data?.payablesSoon.length ? (
            <ul className="dash-list">
              {data.payablesSoon.map((p) => (
                <li key={p.id}>
                  <div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem' }}>
                      <strong>{p.description}</strong>
                      {dueDaysBadge(p.status, p.dueDate)}
                    </div>
                    <div className="dash-list-meta">
                      {p.supplier ?? '—'} · {dueLabelShort(p.status, p.dueDate)}
                      {p.amountRemaining < p.amount - 0.005 ? (
                        <span>
                          {' '}
                          · face {formatBRL(p.amount)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <strong className="dash-list-amt">{formatBRL(p.amountRemaining)}</strong>
                </li>
              ))}
            </ul>
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
          {!overview.isLoading && !data?.receivablesSoon.length && (
            <p className="dash-empty">Sem títulos vencidos ou a receber nos próximos 7 dias.</p>
          )}
          {data?.receivablesSoon.length ? (
            <ul className="dash-list">
              {data.receivablesSoon.map((r) => (
                <li key={r.id}>
                  <div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem' }}>
                      <strong>{r.description}</strong>
                      {dueDaysBadge(r.status, r.dueDate)}
                    </div>
                    <div className="dash-list-meta">
                      {r.customer ?? '—'} · {dueLabelShort(r.status, r.dueDate)}
                      {r.amountRemaining < r.amount - 0.005 ? (
                        <span>
                          {' '}
                          · face {formatBRL(r.amount)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <strong className="dash-list-amt" style={{ color: '#15803d' }}>
                    {formatBRL(r.amountRemaining)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      </section>
    </div>
  );
}
