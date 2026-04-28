import { NavLink, Outlet } from 'react-router-dom';
import '../../components/crud-toolbar.css';

const links = [
  { to: '/estoque/painel', label: 'Painel', end: true },
  { to: '/estoque/entrada', label: 'Entrada de produtos' },
  { to: '/estoque/saidas', label: 'Saídas' },
  { to: '/estoque/locais', label: 'Locais' },
  { to: '/estoque/movimentos', label: 'Movimentos' },
  { to: '/estoque/fechamento', label: 'Fechamento diário' },
] as const;

export function StockShell() {
  return (
    <div className="page print-area">
      <h1 className="page-title">Estoque</h1>
      <p className="page-desc">
        Controle de saldos, entradas fiscais (espelho NF-e), saídas não vinculadas a venda e fechamento
        diário (saldo inicial × entradas × vendas × saídas).
      </p>
      <nav className="stock-subnav no-print" aria-label="Submenu estoque">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={'end' in l ? l.end : false}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
