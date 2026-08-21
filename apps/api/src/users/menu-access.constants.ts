export type MenuAccessAction = 'view' | 'create' | 'update' | 'delete';

export type MenuAccessMeta = {
  key: string;
  label: string;
  /** Se false, a coluna Excluir não aparece na UI. */
  supportsDelete?: boolean;
  /** Se false, não mostra Incluir/Alterar (ex.: Início só exibe). */
  supportsMutations?: boolean;
};

/** Catálogo de menus do sistema (alinhado à sidebar). */
export const MENU_ACCESS_CATALOG: MenuAccessMeta[] = [
  { key: 'home', label: 'Início', supportsMutations: false, supportsDelete: false },
  { key: 'salao', label: 'Salão / Comandas', supportsDelete: true },
  { key: 'clients', label: 'Clientes', supportsDelete: true },
  { key: 'products', label: 'Produtos', supportsDelete: true },
  { key: 'suppliers', label: 'Fornecedores', supportsDelete: true },
  { key: 'stock', label: 'Estoque', supportsDelete: true },
  { key: 'requisitions', label: 'Requisições', supportsDelete: true },
  { key: 'serviceOrders', label: 'Ordens de Serviço', supportsDelete: true },
  { key: 'cash', label: 'Caixa', supportsDelete: false },
  { key: 'cards', label: 'Cartões', supportsDelete: false },
  { key: 'fiscal', label: 'Notas Fiscais', supportsDelete: true },
  { key: 'finance', label: 'Financeiro', supportsDelete: true },
  { key: 'balance', label: 'Balanço', supportsMutations: false, supportsDelete: false },
  { key: 'registers', label: 'Cadastros Gerais', supportsDelete: true },
  { key: 'company', label: 'Empresa', supportsDelete: false },
  { key: 'print', label: 'Impressão', supportsDelete: false },
  { key: 'users', label: 'Usuários', supportsDelete: true },
];

export const MENU_ACCESS_KEYS = MENU_ACCESS_CATALOG.map((m) => m.key);

export type MenuAccessFlags = {
  menuKey: string;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

/**
 * Padrão do perfil Caixa quando ainda não há grant salvo.
 * Balanço, Empresa, Impressão e Usuários ficam ocultos.
 */
export function defaultCashierMenuAccess(menuKey: string): MenuAccessFlags {
  const visibleByDefault = new Set(['home', 'cash', 'cards', 'fiscal']);
  return {
    menuKey,
    canView: visibleByDefault.has(menuKey),
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  };
}

export function routeToMenuKey(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '') return 'home';
  if (p.startsWith('/salao')) return 'salao';
  if (p.startsWith('/clientes')) return 'clients';
  if (p.startsWith('/produtos')) return 'products';
  if (p.startsWith('/fornecedores')) return 'suppliers';
  if (p.startsWith('/estoque')) return 'stock';
  if (p.startsWith('/requisicoes')) return 'requisitions';
  if (p.startsWith('/ordens-servico')) return 'serviceOrders';
  if (p.startsWith('/caixa')) return 'cash';
  if (p.startsWith('/cartoes')) return 'cards';
  if (p.startsWith('/notas-fiscais')) return 'fiscal';
  if (p.startsWith('/financeiro')) return 'finance';
  if (p.startsWith('/balanco')) return 'balance';
  if (p.startsWith('/cadastros')) return 'registers';
  if (p.startsWith('/empresa')) return 'company';
  if (p.startsWith('/configuracoes/impressao')) return 'print';
  if (p.startsWith('/usuarios')) return 'users';
  return null;
}
