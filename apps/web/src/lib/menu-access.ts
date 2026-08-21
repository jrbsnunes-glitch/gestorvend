/** Matriz de acesso por menu (perfil Caixa). */

export type MenuAccessFlags = {
  menuKey: string;
  label: string;
  supportsMutations: boolean;
  supportsDelete: boolean;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

export type MenuAccessResponse = {
  isFullAccess: boolean;
  menus: MenuAccessFlags[];
};

export type MenuAccessAction = 'view' | 'create' | 'update' | 'delete';

const PATH_TO_MENU: Array<{ prefix: string; key: string }> = [
  { prefix: '/salao', key: 'salao' },
  { prefix: '/clientes', key: 'clients' },
  { prefix: '/produtos', key: 'products' },
  { prefix: '/fornecedores', key: 'suppliers' },
  { prefix: '/estoque', key: 'stock' },
  { prefix: '/requisicoes', key: 'requisitions' },
  { prefix: '/ordens-servico', key: 'serviceOrders' },
  { prefix: '/caixa', key: 'cash' },
  { prefix: '/cartoes', key: 'cards' },
  { prefix: '/notas-fiscais', key: 'fiscal' },
  { prefix: '/financeiro', key: 'finance' },
  { prefix: '/balanco', key: 'balance' },
  { prefix: '/cadastros', key: 'registers' },
  { prefix: '/empresa', key: 'company' },
  { prefix: '/configuracoes/impressao', key: 'print' },
  { prefix: '/usuarios', key: 'users' },
];

export function pathToMenuKey(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '') return 'home';
  for (const row of PATH_TO_MENU) {
    if (p === row.prefix || p.startsWith(`${row.prefix}/`)) return row.key;
  }
  return null;
}

export function navPathToMenuKey(to: string): string | null {
  return pathToMenuKey(to);
}

export function canMenu(
  data: MenuAccessResponse | undefined,
  menuKey: string,
  action: MenuAccessAction,
): boolean {
  if (!data) return false;
  if (data.isFullAccess) return true;
  const row = data.menus.find((m) => m.menuKey === menuKey);
  if (!row) return false;
  if (action === 'view') return row.canView;
  if (action === 'create') return row.canCreate;
  if (action === 'update') return row.canUpdate;
  return row.canDelete;
}
