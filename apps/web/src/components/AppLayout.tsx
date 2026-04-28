import { NavLink, Outlet } from 'react-router-dom';
import './layout.css';

const nav = [
  { to: '/', label: 'Início', end: true },
  { to: '/clientes', label: 'Clientes' },
  { to: '/fornecedores', label: 'Fornecedores' },
  { to: '/produtos', label: 'Produtos' },
  { to: '/estoque', label: 'Estoque' },
  { to: '/vendas', label: 'Vendas' },
  { to: '/caixa', label: 'Caixa' },
  { to: '/financeiro', label: 'Financeiro' },
  { to: '/relatorios', label: 'Relatórios' },
] as const;

export function AppLayout({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="sidebar-brand">
          <span className="sidebar-logo">GV</span>
          <div>
            <strong>GestorVend</strong>
            <span className="sidebar-tag">Admin</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                'sidebar-link' + (isActive ? ' sidebar-link-active' : '')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="btn btn-secondary sidebar-logout" onClick={onLogout}>
            Sair
          </button>
        </div>
      </aside>
      <div className="main-area">
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
