import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/cadastros/situacao-fiscal', label: 'Situação fiscal', end: true },
  { to: '/cadastros/formas-pagamento', label: 'Formas de Pagamento' },
] as const;

/** Menu lateral agrupador — cadastros transversais (fiscal mestre etc.). */
export function GeneralRegistersShell() {
  return (
    <div className="page">
      <h1 className="page-title">Cadastros gerais</h1>
      <p className="page-desc">
        Parâmetros fiscais e formas de pagamento usadas no PDV, no caixa e no módulo Cartões.
      </p>
      <nav className="stock-subnav no-print" aria-label="Submenu cadastros gerais">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={'end' in l ? l.end : false} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
