import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getPortalMe, setPortalMe, setPortalToken } from './portal-api';

export function PortalAdminLayout() {
  const me = getPortalMe();
  const navigate = useNavigate();

  function logout() {
    setPortalToken(null);
    setPortalMe(null);
    navigate('/portal-admin/login', { replace: true });
  }

  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <Link to="/portal-admin/clientes" className="portal-brand">
          <img
            className="portal-brand-mark"
            src="/gestor-venda-logo.png"
            alt="Gestor Vendas"
            decoding="async"
          />
          <div>
            <span className="portal-brand-sub">Portal de Licenciamento</span>
          </div>
        </Link>
        <nav className="portal-nav">
          <NavLink to="/portal-admin/clientes" className={({ isActive }) => (isActive ? 'is-active' : '')}>
            Clientes
          </NavLink>
        </nav>
        <div className="portal-userbox">
          {me && (
            <span className="portal-userbox-name" title={me.email}>
              {me.name}
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <main className="portal-main">
        <Outlet />
      </main>
    </div>
  );
}
