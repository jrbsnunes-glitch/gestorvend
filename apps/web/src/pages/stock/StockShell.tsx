import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import { ReportPrintSticker } from '../../components/ReportPrintSticker';
import '../../components/crud-toolbar.css';

const links = [
  { to: '/estoque/painel', label: 'Painel', end: true },
  { to: '/estoque/entrada', label: 'Entrada de produtos' },
  { to: '/estoque/nfe-entrada', label: 'Caixa NF-e' },
  { to: '/estoque/saidas', label: 'Saídas' },
  { to: '/estoque/locais', label: 'Locais' },
  { to: '/estoque/transferencias', label: 'Transferências' },
  { to: '/estoque/inventario', label: 'Inventário' },
  { to: '/estoque/movimentos', label: 'Movimentos' },
  { to: '/estoque/fechamento', label: 'Fechamento diário' },
] as const;

const PRINT_TITLE_BY_PATH: Partial<Record<string, string>> = {
  '/estoque': 'Estoque',
  '/estoque/painel': 'Painel de estoque',
  '/estoque/entrada': 'Entrada de produtos',
  '/estoque/nfe-entrada': 'Caixa de entrada NF-e',
  '/estoque/saidas': 'Saídas de estoque',
  '/estoque/locais': 'Locais de estoque',
  '/estoque/transferencias': 'Transferências',
  '/estoque/inventario': 'Inventário multi-produto',
  '/estoque/movimentos': 'Movimentações',
  '/estoque/fechamento': 'Fechamento diário',
};

export function StockShell() {
  const location = useLocation();
  const printTitle =
    PRINT_TITLE_BY_PATH[location.pathname] ||
    PRINT_TITLE_BY_PATH[location.pathname.replace(/\/$/, '')] ||
    'Estoque';

  const printHint = useMemo(
    () => (
      <p className="print-sub page-desc" style={{ marginBottom: 0 }}>
        Módulo estoque · impressão conforme filtros e aba atual. Conteúdo operacional aparece logo abaixo.
      </p>
    ),
    [],
  );

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
      <ReportPrintSticker documentTitle={printTitle} documentExtras={printHint} />
      <Outlet />
    </div>
  );
}
