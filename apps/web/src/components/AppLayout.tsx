import { useMemo } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { getIdentity, isAdmin, profileFromRoles, profileLabel } from '../lib/auth';
import { useNavigationActivityLogger } from '../lib/use-navigation-activity-log';
import './layout.css';

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  /** Quando true, o item só aparece para usuários com perfil de gerente. */
  managerOnly?: boolean;
  /** Quando true, o item só aparece para usuários com role interna `admin`. */
  adminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Início', end: true },
  { to: '/clientes', label: 'Clientes', managerOnly: true },
  { to: '/fornecedores', label: 'Fornecedores', managerOnly: true },
  { to: '/produtos', label: 'Produtos', managerOnly: true },
  { to: '/estoque', label: 'Estoque', managerOnly: true },
  { to: '/vendas', label: 'Vendas' },
  { to: '/caixa', label: 'Caixa' },
  { to: '/financeiro', label: 'Financeiro', managerOnly: true },
  { to: '/empresa', label: 'Empresa', managerOnly: true },
  { to: '/usuarios', label: 'Usuários', managerOnly: true },
  { to: '/logs', label: 'Logs', adminOnly: true },
];

type Me = { name: string; email: string; profile: 'manager' | 'cashier' };

export function AppLayout({ onLogout }: { onLogout: () => void }) {
  useNavigationActivityLogger();
  // Identidade local (decodificada do JWT) para decidir o menu sem precisar
  // esperar a resposta da API. Em paralelo carregamos os dados reais (`/users/me`)
  // para mostrar nome do operador no rodapé.
  const identity = useMemo(() => getIdentity(), []);
  const localProfile = identity ? profileFromRoles(identity.roles) : 'cashier';
  const isManager = localProfile === 'manager';
  const userIsAdmin = isAdmin();

  const me = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api<Me>('/users/me'),
    staleTime: 5 * 60_000,
  });

  const items = NAV_ITEMS.filter(
    (it) => (!it.managerOnly || isManager) && (!it.adminOnly || userIsAdmin),
  );
  const profile = me.data?.profile ?? localProfile;

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="sidebar-brand">
          <img
            className="sidebar-brand-mark"
            src="/gestor-venda-logo.png"
            alt="Gestor Vendas"
            decoding="async"
          />
          <span className="sidebar-tag">{profileLabel(profile)}</span>
        </div>
        <nav className="sidebar-nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) =>
                'sidebar-link' + (isActive ? ' sidebar-link-active' : '')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {me.data && (
            <div
              style={{
                fontSize: '0.8rem',
                color: '#cbd5e1',
                marginBottom: '0.6rem',
                lineHeight: 1.35,
              }}
            >
              <strong style={{ color: '#f1f5f9', display: 'block' }}>{me.data.name}</strong>
              <span style={{ opacity: 0.75 }}>{me.data.email}</span>
            </div>
          )}
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
