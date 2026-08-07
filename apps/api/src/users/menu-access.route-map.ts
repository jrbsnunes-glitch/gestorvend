import type { MenuAccessAction } from './menu-access.constants';

/**
 * Mapeia rotas da API → menu da matriz de acesso.
 * Mutações (POST/PUT/PATCH/DELETE) nesses caminhos podem ser feitas pelo
 * perfil Caixa (`seller`) quando a flag Incluir/Alterar/Excluir estiver liberada.
 *
 * GET: só aplica «Exibir» em rotas tipicamente restritas a gerente (não no PDV).
 */

const SKIP_PREFIXES = [
  'auth',
  'health',
  'public',
  'portal',
  'activity-logs',
  'dashboard',
  'reports',
  'lookups',
  'branding',
  'license',
  'wachat',
  'sales',
  /** Caixa PDV: abertura/fechamento/movimento — operacional, não matriz. */
  'cash',
  /** Agent de impressão / fila. */
  'printing/agent',
];

/**
 * GETs em que o Roles costuma ser só gerente e a matriz «Exibir» deve valer.
 * Não incluir products/customers/company (PDV, logo, busca).
 */
const VIEW_GATE_PREFIXES = [
  'users',
  'printing',
  'payment-forms',
  'fiscal-codes',
  'fiscal-situations',
  'operation-natures',
  'financial-overview',
  'customer-groups',
  'categories',
  'suppliers',
  'stock-inventories',
  'goods-receipts',
  'stock-transfers',
  'stock-exits',
  'fiscal/documents',
  'fiscal/inbound',
  'fiscal/issuer-settings',
  'card-transactions',
  'finance',
  'restaurant/areas',
  'restaurant/tables',
  'restaurant/stations',
  'restaurant/recipes',
];

/** Prefixo de path (após /api) → menuKey. */
const PREFIX_TO_MENU: Array<{ prefix: string; menuKey: string }> = [
  { prefix: 'customer-groups', menuKey: 'clients' },
  { prefix: 'customers', menuKey: 'clients' },
  { prefix: 'products', menuKey: 'products' },
  { prefix: 'categories', menuKey: 'products' },
  { prefix: 'suppliers', menuKey: 'suppliers' },
  { prefix: 'stock-locations', menuKey: 'stock' },
  { prefix: 'stock-movements', menuKey: 'stock' },
  { prefix: 'stock-transfers', menuKey: 'stock' },
  { prefix: 'stock-exits', menuKey: 'stock' },
  { prefix: 'stock-inventories', menuKey: 'stock' },
  { prefix: 'goods-receipts', menuKey: 'stock' },
  { prefix: 'fiscal/inbound', menuKey: 'stock' },
  { prefix: 'fiscal/issuer-settings', menuKey: 'company' },
  { prefix: 'fiscal/documents', menuKey: 'fiscal' },
  { prefix: 'fiscal', menuKey: 'fiscal' },
  { prefix: 'card-transactions', menuKey: 'cards' },
  { prefix: 'payment-forms', menuKey: 'registers' },
  { prefix: 'fiscal-codes', menuKey: 'registers' },
  { prefix: 'fiscal-situations', menuKey: 'registers' },
  { prefix: 'operation-natures', menuKey: 'registers' },
  { prefix: 'financial-overview', menuKey: 'balance' },
  { prefix: 'finance', menuKey: 'finance' },
  { prefix: 'company', menuKey: 'company' },
  { prefix: 'printing', menuKey: 'print' },
  { prefix: 'users', menuKey: 'users' },
  { prefix: 'restaurant', menuKey: 'salao' },
];

export type MenuAccessEnforcement = {
  menuKey: string;
  action: MenuAccessAction;
};

function normalizeApiPath(url: string): { path: string; segments: string[] } {
  const raw = (url.split('?')[0] ?? '').replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const path = raw.replace(/^\//, '');
  const segments = path ? path.split('/').filter(Boolean) : [];
  return { path, segments };
}

function menuKeyForPath(path: string, segments: string[]): string | null {
  if (!segments.length) return null;

  for (const skip of SKIP_PREFIXES) {
    if (path === skip || path.startsWith(`${skip}/`)) return null;
  }

  // Salão: operações de comanda (tabs) são operacionais (garçom/caixa no piso).
  if (segments[0] === 'restaurant' && segments[1] === 'tabs') return null;

  if (path.startsWith('products/maintenance')) return null;

  // /users/me* é do próprio operador — sem matriz.
  if (segments[0] === 'users' && segments[1] === 'me') return null;

  for (const row of PREFIX_TO_MENU) {
    if (path === row.prefix || path.startsWith(`${row.prefix}/`)) {
      return row.menuKey;
    }
  }

  return null;
}

function pathMatchesViewGate(path: string): boolean {
  return VIEW_GATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function actionForMutation(method: string, segments: string[]): MenuAccessAction {
  const last = (segments[segments.length - 1] ?? '').toLowerCase();

  if (method === 'DELETE') return 'delete';
  if (method === 'PATCH' || method === 'PUT') return 'update';

  if (method === 'POST') {
    if (
      last === 'cancel' ||
      last === 'remove' ||
      last === 'unreconcile' ||
      last === 'delete'
    ) {
      return 'delete';
    }
    if (
      last === 'pay' ||
      last === 'receive' ||
      last === 'settle' ||
      last === 'reopen' ||
      last === 'post' ||
      last === 'close' ||
      last === 'reconcile' ||
      last === 'import-csv' ||
      last === 'export-csv' ||
      last === 'items' ||
      last === 'bulk' ||
      last === 'kitchen-print' ||
      last === 'supplier-links' ||
      segments.includes('items') ||
      segments.includes('credit-adjustments')
    ) {
      return 'update';
    }
    return 'create';
  }

  return 'view';
}

/**
 * Se retornar enforcement, o perfil `seller` pode passar no RolesGuard
 * e o MenuAccessInterceptor exige a flag correspondente (ou senha do gerente).
 */
export function resolveMenuAccessEnforcement(
  method: string,
  url: string,
): MenuAccessEnforcement | null {
  const m = method.toUpperCase();
  const { path, segments } = normalizeApiPath(url);
  const menuKey = menuKeyForPath(path, segments);
  if (!menuKey) return null;

  if (m === 'GET' || m === 'HEAD') {
    if (!pathMatchesViewGate(path)) return null;
    return { menuKey, action: 'view' };
  }

  if (m === 'OPTIONS') return null;

  return {
    menuKey,
    action: actionForMutation(m, segments),
  };
}

export function managerPasswordFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const v = (body as { managerPassword?: unknown }).managerPassword;
  return typeof v === 'string' ? v : undefined;
}
