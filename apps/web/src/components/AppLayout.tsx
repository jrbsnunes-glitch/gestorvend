import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CompanyLogo } from './CompanyLogo';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import { NavIcon, type NavIconName } from './nav-icons';
import { api } from '../lib/api';
import { companyDisplayName } from '../lib/company-branding';
import { getIdentity, isAdmin, profileFromRoles, profileLabel } from '../lib/auth';
import { APP_VERSION } from '../version';
import './layout.css';

const SIDEBAR_COLLAPSED_KEY = 'gv-sidebar-collapsed';

type NavItem = {
  to: string;
  label: string;
  icon: NavIconName;
  end?: boolean;
  /** Quando true, o item só aparece para usuários com perfil de gerente. */
  managerOnly?: boolean;
  /** Com `managerOnly: true`, também exibe para usuários com role `finance`. */
  allowFinanceRole?: boolean;
  /** Quando true, o item só aparece para usuários com role interna `admin`. */
  adminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Início', icon: 'home', end: true },
  { to: '/vendas', label: 'Vendas', icon: 'sales' },
  { to: '/clientes', label: 'Clientes', icon: 'customers', managerOnly: true },
  { to: '/produtos', label: 'Produtos', icon: 'products', managerOnly: true },
  { to: '/fornecedores', label: 'Fornecedores', icon: 'suppliers', managerOnly: true },
  { to: '/estoque', label: 'Estoque', icon: 'stock', managerOnly: true },
  { to: '/caixa', label: 'Caixa', icon: 'cash' },
  { to: '/cartoes', label: 'Cartões', icon: 'cards' },
  { to: '/notas-fiscais', label: 'Notas Fiscais', icon: 'fiscal' },
  { to: '/financeiro', label: 'Financeiro', icon: 'finance', managerOnly: true, allowFinanceRole: true },
  { to: '/balanco', label: 'Balanço', icon: 'balance', managerOnly: true, allowFinanceRole: true },
  { to: '/cadastros', label: 'Cadastros Gerais', icon: 'registers', managerOnly: true },
  { to: '/empresa', label: 'Empresa', icon: 'company', managerOnly: true },
  { to: '/usuarios', label: 'Usuários', icon: 'users', managerOnly: true },
  { to: '/logs', label: 'Logs', icon: 'logs', adminOnly: true },
];

type Me = { name: string; email: string; profile: 'manager' | 'cashier' };

function readCollapsedPref(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppLayout({ onLogout }: { onLogout: () => void }) {
  // Identidade local (decodificada do JWT) para decidir o menu sem precisar
  // esperar a resposta da API. Em paralelo carregamos os dados reais (`/users/me`)
  // para mostrar nome do operador no rodapé.
  const identity = useMemo(() => getIdentity(), []);
  const localProfile = identity ? profileFromRoles(identity.roles) : 'cashier';
  const isManager = localProfile === 'manager';
  const hasFinance = identity?.roles.includes('finance') ?? false;
  const userIsAdmin = isAdmin();

  const [collapsed, setCollapsed] = useState(readCollapsedPref);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const me = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api<Me>('/users/me'),
    staleTime: 5 * 60_000,
  });

  const company = useQuery({
    queryKey: ['company'],
    queryFn: () =>
      api<{ tradeName: string; legalName: string; logoUrl?: string | null }>('/company'),
    staleTime: 10 * 60_000,
  });

  const items = NAV_ITEMS.filter((it) => {
    if (it.adminOnly && !userIsAdmin) return false;
    if (it.managerOnly) {
      const ok = isManager || (it.allowFinanceRole === true && hasFinance);
      if (!ok) return false;
    }
    return true;
  });
  const profile = me.data?.profile ?? localProfile;

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
  }, [collapsed]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  function toggleCollapsed() {
    setCollapsed((v) => !v);
  }

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  const shellClass =
    'app-shell' +
    (collapsed ? ' app-shell--sidebar-collapsed' : '') +
    (mobileNavOpen ? ' app-shell--mobile-nav-open' : '');

  const sidebarClass =
    'sidebar' +
    (collapsed ? ' sidebar--collapsed' : '') +
    (mobileNavOpen ? ' sidebar--mobile-open' : '');

  return (
    <div className={shellClass}>
      {mobileNavOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Fechar menu"
          onClick={closeMobileNav}
        />
      )}

      <aside className={sidebarClass} aria-label="Navegação principal">
        <div className="sidebar-brand">
          <div className="sidebar-brand-top">
            <CompanyLogo
              className="sidebar-brand-mark"
              company={company.data ?? null}
              alt={companyDisplayName(company.data)}
            />
            <button
              type="button"
              className="sidebar-toggle sidebar-toggle--desktop"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-controls="sidebar-nav"
              title={collapsed ? 'Expandir menu' : 'Minimizar menu'}
            >
              <NavIcon name={collapsed ? 'expand' : 'collapse'} />
              <span className="sidebar-link-label">
                {collapsed ? 'Expandir' : 'Minimizar'}
              </span>
            </button>
            <button
              type="button"
              className="sidebar-toggle sidebar-toggle--mobile-close"
              onClick={closeMobileNav}
              aria-label="Fechar menu"
            >
              <NavIcon name="close" />
            </button>
          </div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">{companyDisplayName(company.data)}</span>
            <span className="sidebar-app-version" title="Versão do sistema">
              v{APP_VERSION}
            </span>
          </div>
          <span className="sidebar-tag">{profileLabel(profile)}</span>
        </div>

        <nav id="sidebar-nav" className="sidebar-nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              title={item.label}
              aria-label={item.label}
              onClick={closeMobileNav}
              className={({ isActive }) => {
                let cls = 'sidebar-link';
                if (item.to === '/vendas') {
                  cls += ' sidebar-link-vendas';
                  if (isActive) cls += ' sidebar-link-vendas--current';
                } else if (isActive) {
                  cls += ' sidebar-link-active';
                }
                return cls;
              }}
            >
              <NavIcon name={item.icon} />
              <span className="sidebar-link-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {me.data && (
            <div className="sidebar-user">
              <strong className="sidebar-user-name">{me.data.name}</strong>
              <span className="sidebar-user-email">{me.data.email}</span>
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary sidebar-logout"
            onClick={onLogout}
            title="Sair"
            aria-label="Sair"
          >
            <NavIcon name="logout" />
            <span className="sidebar-link-label">Sair</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <div className="main-topbar">
          <button
            type="button"
            className="sidebar-hamburger"
            onClick={() => setMobileNavOpen(true)}
            aria-expanded={mobileNavOpen}
            aria-controls="sidebar-nav"
            aria-label="Abrir menu"
          >
            <NavIcon name="menu" />
          </button>
          <span className="main-topbar-title">{companyDisplayName(company.data)}</span>
        </div>
        <ConnectionStatusBanner />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
