import { NavLink } from 'react-router-dom';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `mfg-subnav__link${isActive ? ' is-active' : ''}`;

/** Submenu do módulo Fábrica (projetos × fichas técnicas). */
export function ManufacturingNav() {
  return (
    <nav className="mfg-subnav" aria-label="Menu Fábrica">
      <NavLink to="/fabrica" end className={linkClass}>
        Projetos
      </NavLink>
      <NavLink to="/fabrica/fichas-tecnicas" className={linkClass}>
        Fichas técnicas
      </NavLink>
      <NavLink to="/fabrica/agenda" className={linkClass}>
        Agenda
      </NavLink>
      <NavLink to="/fabrica/mrp" className={linkClass}>
        MRP
      </NavLink>
      <NavLink to="/fabrica/configuracoes" className={linkClass}>
        Configurações
      </NavLink>
    </nav>
  );
}
