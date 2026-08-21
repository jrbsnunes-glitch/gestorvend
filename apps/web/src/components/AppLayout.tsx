import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CompanyLogo } from './CompanyLogo';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import { DesktopUpdateBanner } from './DesktopUpdateBanner';
import { NavIcon, type NavIconName } from './nav-icons';
import { api } from '../lib/api';
import { companyDisplayName } from '../lib/company-branding';
import { getIdentity, hasRestaurantPlan, hasServiceOrderModule, isAdmin, isTechnician, isWaiter, profileFromRoles, profileLabel } from '../lib/auth';
import { navPathToMenuKey } from '../lib/menu-access';
import { useMenuAccess } from '../hooks/useMenuAccess';
import { APP_VERSION } from '../version';
import './layout.css';

const SIDEBAR_COLLAPSED_KEY = 'gv-sidebar-collapsed';

type NavGroup = 'vendas' | 'catalogo' | 'gestao' | 'sistema';

type NavItem = {
  to: string;
  label: string;
  icon: NavIconName;
  group: NavGroup;
  end?: boolean;
  /** Quando true, o item só aparece para usuários com perfil de gerente. */
  managerOnly?: boolean;
  /** Com `managerOnly: true`, também exibe para usuários com role `finance`. */
  allowFinanceRole?: boolean;
  /** Quando true, o item só aparece para usuários com role interna `admin`. */
  adminOnly?: boolean;
  /** Exige plano RESTAURANT no JWT. */
  restaurantPlan?: boolean;
  /** Exige addon SERVICE_ORDER no JWT + flag da empresa. */
  serviceOrderModule?: boolean;
  /** Garçom só vê itens marcados (Salão). */
  waiterAllowed?: boolean;
  /** Técnico (OS) só vê itens marcados (Ordens de Serviço). */
  technicianAllowed?: boolean;
};

const GROUP_LABEL: Record<NavGroup, string> = {
  vendas: 'VENDAS',
  catalogo: 'CATÁLOGO',
  gestao: 'GESTÃO',
  sistema: 'SISTEMA',
};

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Início', icon: 'home', group: 'vendas', end: true },
  { to: '/salao', label: 'Salão / Comandas', icon: 'restaurant', group: 'vendas', restaurantPlan: true, waiterAllowed: true },
  { to: '/clientes', label: 'Clientes', icon: 'customers', group: 'catalogo', managerOnly: true },
  { to: '/produtos', label: 'Produtos', icon: 'products', group: 'catalogo', managerOnly: true },
  { to: '/fornecedores', label: 'Fornecedores', icon: 'suppliers', group: 'catalogo', managerOnly: true },
  { to: '/estoque', label: 'Estoque', icon: 'stock', group: 'catalogo', managerOnly: true },
  { to: '/requisicoes', label: 'Requisições', icon: 'requisitions', group: 'gestao', managerOnly: true },
  { to: '/ordens-servico', label: 'Ordens de Serviço', icon: 'serviceOrders', group: 'gestao', managerOnly: true, serviceOrderModule: true, technicianAllowed: true },
  { to: '/caixa', label: 'Caixa', icon: 'cash', group: 'gestao' },
  { to: '/cartoes', label: 'Cartões', icon: 'cards', group: 'gestao' },
  { to: '/notas-fiscais', label: 'Notas Fiscais', icon: 'fiscal', group: 'gestao' },
  { to: '/financeiro', label: 'Financeiro', icon: 'finance', group: 'gestao', managerOnly: true, allowFinanceRole: true },
  { to: '/balanco', label: 'Balanço', icon: 'balance', group: 'gestao', managerOnly: true, allowFinanceRole: true },
  { to: '/cadastros', label: 'Cadastros Gerais', icon: 'registers', group: 'sistema', managerOnly: true },
  { to: '/empresa', label: 'Empresa', icon: 'company', group: 'sistema', managerOnly: true },
  { to: '/configuracoes/impressao', label: 'Impressão', icon: 'settings', group: 'sistema', managerOnly: true },
  { to: '/usuarios', label: 'Usuários', icon: 'users', group: 'sistema', managerOnly: true },
  { to: '/logs', label: 'Logs', icon: 'logs', group: 'sistema', adminOnly: true },
];

/** Preferência de abas inferiores no mobile (completar com próximas permitidas). */
const MOBILE_TAB_PREF = ['/', '/estoque', '/caixa', '/financeiro'];

type Me = { name: string; email: string; profile: 'manager' | 'cashier' | 'waiter' | 'technician' };

function readCollapsedPref(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AppLayout({ onLogout }: { onLogout: () => void }) {
  const identity = useMemo(() => getIdentity(), []);
  const localProfile = identity ? profileFromRoles(identity.roles) : 'cashier';
  const isManager = localProfile === 'manager';
  const waiterOnly = localProfile === 'waiter' || isWaiter();
  const technicianOnly = localProfile === 'technician' || isTechnician();
  const hasFinance = identity?.roles.includes('finance') ?? false;
  const userIsAdmin = isAdmin();
  const restaurantOk = hasRestaurantPlan();
  const serviceOrderOk = hasServiceOrderModule();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(readCollapsedPref);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const me = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api<Me>('/users/me'),
    staleTime: 5 * 60_000,
  });

  const company = useQuery({
    queryKey: ['company'],
    queryFn: () =>
      api<{
        tradeName: string;
        legalName: string;
        logoUrl?: string | null;
        restaurantModuleEnabled?: boolean;
        serviceOrderModuleEnabled?: boolean;
      }>('/company'),
    staleTime: 10 * 60_000,
  });

  const menuAccess = useMenuAccess();

  const items = NAV_ITEMS.filter((it) => {
    if (waiterOnly) {
      return Boolean(it.waiterAllowed);
    }
    if (technicianOnly) {
      return Boolean(it.technicianAllowed);
    }
    if (it.adminOnly && !userIsAdmin) return false;
    if (it.restaurantPlan) {
      if (!restaurantOk) return false;
      if (company.isSuccess && company.data.restaurantModuleEnabled !== true) return false;
    }
    if (it.serviceOrderModule) {
      if (!serviceOrderOk) return false;
      if (company.isSuccess && company.data.serviceOrderModuleEnabled !== true) return false;
    }
    // Caixa: visibilidade controlada pela matriz de menus (padrão oculta Balanço/Empresa/Impressão/Usuários).
    if (!isManager) {
      const menuKey = navPathToMenuKey(it.to);
      if (menuKey) {
        if (menuAccess.isLoading && !menuAccess.data) {
          // Enquanto carrega, mantém o comportamento antigo (managerOnly).
          if (it.managerOnly) {
            const ok = it.allowFinanceRole === true && hasFinance;
            if (!ok) return false;
          }
        } else if (!menuAccess.canView(menuKey)) {
          return false;
        }
      } else if (it.managerOnly) {
        const ok = it.allowFinanceRole === true && hasFinance;
        if (!ok) return false;
      }
    }
    return true;
  });

  const grouped = useMemo(() => {
    const order: NavGroup[] = ['vendas', 'catalogo', 'gestao', 'sistema'];
    return order
      .map((g) => ({ group: g, label: GROUP_LABEL[g], items: items.filter((i) => i.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [items]);

  const mobileTabs = useMemo(() => {
    if (waiterOnly) {
      return items.filter((i) => i.to === '/salao').slice(0, 4);
    }
    if (technicianOnly) {
      return items.filter((i) => i.to.startsWith('/ordens-servico')).slice(0, 4);
    }
    const byTo = new Map(items.map((i) => [i.to, i]));
    const preferred: NavItem[] = [];
    for (const to of MOBILE_TAB_PREF) {
      const hit = byTo.get(to);
      if (hit) preferred.push(hit);
    }
    if (preferred.length < 4) {
      for (const it of items) {
        if (preferred.length >= 4) break;
        if (!preferred.some((p) => p.to === it.to) && it.to !== '/vendas') preferred.push(it);
      }
    }
    return preferred.slice(0, 4);
  }, [items, waiterOnly, technicianOnly]);

  const profile = me.data?.profile ?? localProfile;

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
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

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (profileRef.current && !profileRef.current.contains(t)) setProfileOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (waiterOnly && !location.pathname.startsWith('/salao')) {
    return <Navigate to="/salao" replace />;
  }

  if (technicianOnly && !location.pathname.startsWith('/ordens-servico')) {
    return <Navigate to="/ordens-servico" replace />;
  }

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

  const showNovaVenda = !waiterOnly && !technicianOnly;

  const profileMenu = (
    <div className="topbar-profile" ref={profileRef}>
      <button
        type="button"
        className="topbar-avatar-btn"
        aria-expanded={profileOpen}
        aria-haspopup="menu"
        onClick={() => setProfileOpen((v) => !v)}
      >
        <span className="topbar-avatar">{initials(me.data?.name ?? 'U')}</span>
        <span className="topbar-avatar-meta">
          <strong>{me.data?.name ?? 'Usuário'}</strong>
          <span>{profileLabel(profile)}</span>
        </span>
        <NavIcon name="chevron-down" />
      </button>
      {profileOpen && (
        <div className="topbar-profile-menu" role="menu">
          {isManager ? (
            <>
              <Link
                to="/usuarios"
                role="menuitem"
                onClick={() => setProfileOpen(false)}
              >
                <NavIcon name="user" /> Meu Perfil
              </Link>
              <Link
                to="/empresa"
                role="menuitem"
                onClick={() => setProfileOpen(false)}
              >
                <NavIcon name="settings" /> Empresa
              </Link>
              <Link
                to="/configuracoes/impressao"
                role="menuitem"
                onClick={() => setProfileOpen(false)}
              >
                <NavIcon name="settings" /> Impressão (cozinha)
              </Link>
            </>
          ) : null}
          <button type="button" role="menuitem" onClick={onLogout}>
            <NavIcon name="logout" /> Sair
          </button>
        </div>
      )}
    </div>
  );

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
              variant="white"
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

        {showNovaVenda ? (
          <Link
            to="/vendas"
            className="sidebar-cta"
            title="VENDA - PDV"
            onClick={closeMobileNav}
          >
            <NavIcon name="sales" />
            <span className="sidebar-link-label">VENDA - PDV</span>
          </Link>
        ) : null}

        <nav id="sidebar-nav" className="sidebar-nav">
          {grouped.map((g) => (
            <div key={g.group} className="sidebar-group">
              <div className="sidebar-group-label">{g.label}</div>
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end ?? false}
                  title={item.label}
                  aria-label={item.label}
                  onClick={closeMobileNav}
                  className={({ isActive }) =>
                    'sidebar-link' + (isActive ? ' sidebar-link-active' : '')
                  }
                >
                  <NavIcon name={item.icon} />
                  <span className="sidebar-link-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
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
          <div className="topbar-search-spacer" />
          {profileMenu}
        </div>
        <ConnectionStatusBanner />
        <DesktopUpdateBanner />
        <main className="main-content">
          <Outlet />
        </main>

        {mobileTabs.length > 0 ? (
          <nav className="mobile-tabbar" aria-label="Atalhos">
            {mobileTabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end ?? false}
                className={({ isActive }) =>
                  'mobile-tabbar-item' + (isActive ? ' mobile-tabbar-item--active' : '')
                }
              >
                <NavIcon name={tab.icon} />
                <span>{tab.label.split(' ')[0]}</span>
              </NavLink>
            ))}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
