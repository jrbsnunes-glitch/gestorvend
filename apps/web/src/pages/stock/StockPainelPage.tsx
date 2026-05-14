import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CrudToolbar } from '../../components/CrudToolbar';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { api } from '../../lib/api';

type PainelOverview = {
  today: {
    movementCount: number;
    totalInQty: number;
    totalOutQty: number;
    totalAdjustQty: number;
    bySource: Array<{
      source: string;
      count: number;
      inQty: number;
      outQty: number;
      adjustQty: number;
    }>;
  };
  last7Days: {
    movementCount: number;
    totalInQty: number;
    totalOutQty: number;
    totalAdjustQty: number;
  };
  recent: Array<{
    id: string;
    controlNumber: number;
    type: string;
    source: string;
    quantity: string;
    createdAt: string;
    variant: { sku: string; product: { name: string } };
    location: { code: string; name: string };
    userName: string | null;
  }>;
};

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    GOODS_RECEIPT: 'Entrada / NF',
    SALE: 'Venda (PDV)',
    MANUAL_OUT: 'Saída manual',
    ADJUSTMENT: 'Ajuste',
    OTHER: 'Outras',
    TRANSFER: 'Transferência',
  };
  return map[source] ?? source;
}

export function StockPainelPage() {
  const [reportsOpen, setReportsOpen] = useState(false);

  const overview = useQuery({
    queryKey: ['stock-movements', 'painel-overview'],
    queryFn: () => api<PainelOverview>('/stock-movements/painel-overview'),
    refetchOnMount: 'always',
    refetchInterval: 60_000,
  });

  const d = overview.data;

  return (
    <div className="print-area stock-painel-dashboard">
      <CrudToolbar onPrint={() => window.print()} onReports={() => setReportsOpen(true)} />

      <ModuleReportsModal open={reportsOpen} title="Estoque (painel)" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Posição consolidada por local</li>
          <li>Curva ABC de produtos (futuro)</li>
        </ul>
      </ModuleReportsModal>

      {overview.isError && (
        <div className="alert alert-error">{(overview.error as Error).message}</div>
      )}

      <section className="dash-hero no-print" aria-label="Resumo de movimentações hoje">
        <article className="dash-hero-card dash-hero-stock">
          <span className="dash-hero-label">Lançamentos hoje</span>
          <strong className="dash-hero-value">
            {overview.isLoading ? '…' : (d?.today.movementCount ?? 0).toLocaleString('pt-BR')}
          </strong>
          <span className="dash-hero-foot">Movimentos registrados no dia</span>
        </article>
        <article className="dash-hero-card">
          <span className="dash-hero-label">Entradas (qtd)</span>
          <strong className="dash-hero-value" style={{ fontSize: '1.65rem' }}>
            {overview.isLoading ? '…' : fmtQty(d?.today.totalInQty ?? 0)}
          </strong>
          <span className="dash-hero-foot">Soma das quantidades tipo IN hoje</span>
        </article>
        <article className="dash-hero-card">
          <span className="dash-hero-label">Saídas (qtd)</span>
          <strong className="dash-hero-value" style={{ fontSize: '1.65rem' }}>
            {overview.isLoading ? '…' : fmtQty(d?.today.totalOutQty ?? 0)}
          </strong>
          <span className="dash-hero-foot">Soma das quantidades tipo OUT hoje</span>
        </article>
        <article className="dash-hero-card">
          <span className="dash-hero-label">Ajustes (qtd)</span>
          <strong className="dash-hero-value" style={{ fontSize: '1.65rem' }}>
            {overview.isLoading ? '…' : fmtQty(d?.today.totalAdjustQty ?? 0)}
          </strong>
          <span className="dash-hero-foot">Inventário / correções hoje</span>
        </article>
      </section>

      <section className="dash-grid no-print">
        <article className="card dash-block">
          <header className="dash-block-head">
            <h2>Por origem (hoje)</h2>
            <Link to="/estoque/movimentos" className="dash-block-link">
              Movimentos →
            </Link>
          </header>
          {overview.isLoading && <p className="dash-empty">Carregando…</p>}
          {!overview.isLoading && !d?.today.bySource.length && (
            <p className="dash-empty">Nenhuma movimentação hoje ainda.</p>
          )}
          {d?.today.bySource.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Origem</th>
                    <th style={{ textAlign: 'right' }}>Lotes</th>
                    <th style={{ textAlign: 'right' }}>Entrada</th>
                    <th style={{ textAlign: 'right' }}>Saída</th>
                    <th style={{ textAlign: 'right' }}>Ajuste</th>
                  </tr>
                </thead>
                <tbody>
                  {d.today.bySource.map((row) => (
                    <tr key={row.source}>
                      <td>{sourceLabel(row.source)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {row.count}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtQty(row.inQty)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtQty(row.outQty)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtQty(row.adjustQty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article className="card dash-block">
          <header className="dash-block-head">
            <h2>Últimos 7 dias</h2>
            <span className="dash-block-link" style={{ cursor: 'default', color: 'var(--color-text-muted)' }}>
              Inclui hoje
            </span>
          </header>
          {overview.isLoading && <p className="dash-empty">Carregando…</p>}
          {!overview.isLoading && d ? (
            <ul className="dash-list" style={{ margin: 0 }}>
              <li>
                <div>
                  <strong>Movimentos</strong>
                  <div className="dash-list-meta">Total de lançamentos</div>
                </div>
                <span className="dash-list-amt">{d.last7Days.movementCount.toLocaleString('pt-BR')}</span>
              </li>
              <li>
                <div>
                  <strong>Entradas acumuladas</strong>
                  <div className="dash-list-meta">Quantidade (tipo IN)</div>
                </div>
                <span className="dash-list-amt">{fmtQty(d.last7Days.totalInQty)}</span>
              </li>
              <li>
                <div>
                  <strong>Saídas acumuladas</strong>
                  <div className="dash-list-meta">Quantidade (tipo OUT)</div>
                </div>
                <span className="dash-list-amt">{fmtQty(d.last7Days.totalOutQty)}</span>
              </li>
              <li>
                <div>
                  <strong>Ajustes acumulados</strong>
                  <div className="dash-list-meta">Quantidade (tipo ADJUST)</div>
                </div>
                <span className="dash-list-amt">{fmtQty(d.last7Days.totalAdjustQty)}</span>
              </li>
            </ul>
          ) : null}
        </article>
      </section>

      <article className="card dash-block" style={{ marginBottom: '1rem' }}>
        <header className="dash-block-head">
          <h2>Últimas movimentações</h2>
          <Link to="/estoque/movimentos" className="dash-block-link">
            Ver todas →
          </Link>
        </header>
        {overview.isLoading && <p className="dash-empty">Carregando…</p>}
        {!overview.isLoading && !d?.recent.length && (
          <p className="dash-empty">Nenhum lançamento registrado ainda.</p>
        )}
        {d?.recent.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Origem</th>
                  <th>Produto</th>
                  <th>Local</th>
                  <th>Qtd</th>
                  <th>Operador</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      #{m.controlNumber}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                      {new Date(m.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td>
                      <span className="badge badge-muted">{m.type}</span>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{sourceLabel(m.source)}</td>
                    <td>
                      <strong>{m.variant.product.name}</strong>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {m.variant.sku}
                      </div>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{m.location.code}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.quantity}</td>
                    <td style={{ fontSize: '0.85rem' }}>{m.userName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      <div className="nfe-grid no-print">
        <div className="stat-grid">
          <Link to="/estoque/entrada" className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="label">Entrada</div>
            <div className="value" style={{ fontSize: '1rem' }}>
              Recebimento NF-e / sem chave
            </div>
          </Link>
          <Link to="/estoque/saidas" className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="label">Saídas</div>
            <div className="value" style={{ fontSize: '1rem' }}>
              Avaria, perda, uso interno
            </div>
          </Link>
          <Link to="/estoque/fechamento" className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="label">Fechamento</div>
            <div className="value" style={{ fontSize: '1rem' }}>
              Saldo inicial × movimentos do dia
            </div>
          </Link>
        </div>
        <div className="card">
          <h2 className="page-title" style={{ fontSize: '1.05rem' }}>
            Boas práticas de controle
          </h2>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--color-text-secondary)', fontSize: '0.95rem' }}>
            <li>
              <strong>Saldo inicial do dia</strong> é obtido por replay de todas as movimentações até o início do dia
              (inclui ajustes absolutos).
            </li>
            <li>
              <strong>Entradas de compra</strong> usam origem <code>GOODS_RECEIPT</code> (tela Entrada de produtos ou NF).
            </li>
            <li>
              <strong>Vendas</strong> geram saídas com origem <code>SALE</code> automaticamente no PDV.
            </li>
            <li>
              <strong>Saídas diversas</strong> (avaria etc.) usam origem <code>MANUAL_OUT</code> na tela Saídas.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
