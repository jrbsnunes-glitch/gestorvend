/** Definições de menu para registro de logs (prefixos mais específicos primeiro). */
export type NavMenuRouteDef = {
  prefix: string;
  key: string;
  label: string;
};

export const NAV_MENU_ROUTE_DEFS: NavMenuRouteDef[] = [
  { prefix: '/estoque/movimentos', key: 'estoque-movimentos', label: 'Estoque · Movimentações' },
  { prefix: '/estoque/transferencias', key: 'estoque-transferencias', label: 'Estoque · Transferências' },
  { prefix: '/estoque/inventario', key: 'estoque-inventario', label: 'Estoque · Inventário' },
  { prefix: '/estoque/fechamento', key: 'estoque-fechamento', label: 'Estoque · Fechamento' },
  { prefix: '/estoque/locais', key: 'estoque-locais', label: 'Estoque · Locais' },
  { prefix: '/estoque/saidas', key: 'estoque-saidas', label: 'Estoque · Saídas' },
  { prefix: '/estoque/entrada', key: 'estoque-entrada', label: 'Estoque · Entrada' },
  { prefix: '/estoque/painel', key: 'estoque-painel', label: 'Estoque · Painel' },
  { prefix: '/estoque', key: 'estoque', label: 'Estoque' },
  { prefix: '/clientes', key: 'clientes', label: 'Clientes' },
  { prefix: '/fornecedores', key: 'fornecedores', label: 'Fornecedores' },
  { prefix: '/produtos', key: 'produtos', label: 'Produtos' },
  { prefix: '/cadastros/situacao-fiscal', key: 'cadastros-fiscal-situacao', label: 'Cadastros gerais · Situação fiscal' },
  { prefix: '/cadastros', key: 'cadastros', label: 'Cadastros gerais' },
  { prefix: '/balanco/relatorios', key: 'balanco-relatorios', label: 'Balanço · Relatórios' },
  { prefix: '/balanco', key: 'balanco', label: 'Balanço financeiro' },
  { prefix: '/financeiro/impressao', key: 'financeiro-impressao', label: 'Financeiro · Impressão' },
  { prefix: '/financeiro', key: 'financeiro', label: 'Financeiro' },
  { prefix: '/usuarios', key: 'usuarios', label: 'Usuários' },
  { prefix: '/empresa', key: 'empresa', label: 'Empresa' },
  { prefix: '/caixa', key: 'caixa', label: 'Caixa' },
  { prefix: '/logs', key: 'logs', label: 'Logs' },
  { prefix: '/', key: 'inicio', label: 'Início' },
];

const SORTED = [...NAV_MENU_ROUTE_DEFS].sort((a, b) => b.prefix.length - a.prefix.length);

/** Opções para filtro no relatório de logs. */
export const NAV_MENU_FILTER_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'inicio', label: 'Início' },
  ...NAV_MENU_ROUTE_DEFS.filter((d) => d.prefix !== '/').map((d) => ({ key: d.key, label: d.label })),
];

export function resolveNavMenuMeta(pathname: string): { path: string; menuKey: string; menuLabel: string } {
  const path = pathname && pathname !== '' ? pathname : '/';
  for (const def of SORTED) {
    if (def.prefix === '/') {
      if (path === '/') return { path, menuKey: def.key, menuLabel: def.label };
      continue;
    }
    if (path === def.prefix || path.startsWith(`${def.prefix}/`)) {
      return { path, menuKey: def.key, menuLabel: def.label };
    }
  }
  return { path, menuKey: 'outros', menuLabel: 'Outra rota' };
}
