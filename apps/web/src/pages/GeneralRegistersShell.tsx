import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/cadastros/situacao-fiscal', label: 'Situação fiscal', end: true },
] as const;

/** Menu lateral agrupador — cadastros transversais (fiscal mestre etc.). */
export function GeneralRegistersShell() {
  return (
    <div className="page">
      <h1 className="page-title">Cadastros gerais</h1>
      <p className="page-desc">
        Parâmetros fiscais compartilhados por vários produtos — NCM orientador, CST, CFOP sugeridos e
        alíquotas de referência CBS/IBS na transição (LC 214/2025).
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
