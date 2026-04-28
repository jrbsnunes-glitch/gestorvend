import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CrudToolbar } from '../../components/CrudToolbar';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { RecentMovementsSection } from './RecentMovementsSection';

export function StockPainelPage() {
  const [reportsOpen, setReportsOpen] = useState(false);

  return (
    <div className="print-area">
      <CrudToolbar onPrint={() => window.print()} onReports={() => setReportsOpen(true)} />

      <ModuleReportsModal open={reportsOpen} title="Estoque (painel)" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Posição consolidada por local</li>
          <li>Curva ABC de produtos (futuro)</li>
        </ul>
      </ModuleReportsModal>

      <RecentMovementsSection take={20} />
      <div className="nfe-grid">
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
