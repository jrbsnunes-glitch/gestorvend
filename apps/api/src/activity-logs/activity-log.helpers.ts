import { ActivityLogAction } from '../generated/tenant-client';

const ENTITY_LABELS: Record<string, string> = {
  customers: 'cliente',
  suppliers: 'fornecedor',
  products: 'produto',
  categories: 'categoria',
  users: 'usuário',
  company: 'empresa',
  'stock-locations': 'local de estoque',
  'stock-transfers': 'transferência de estoque',
  'stock-exits': 'saída de estoque',
  'stock-movements': 'movimentação de estoque',
  'goods-receipts': 'entrada de mercadorias',
  'fiscal-situations': 'situação fiscal',
  'fiscal-codes': 'código fiscal',
  'fiscal/issuer-settings': 'emissor fiscal',
  payables: 'conta a pagar',
  receivables: 'conta a receber',
  'payment-forms': 'forma de pagamento',
  'customer-groups': 'grupo de cliente',
};

const REPORT_LABELS: Record<string, string> = {
  'sales-summary': 'Resumo de vendas',
  'stock-position': 'Posição de estoque',
  'stock-daily': 'Estoque diário',
  'product-movements': 'Movimentação de produtos',
  'product-turnover': 'Giro de produtos',
  'export/sales.csv': 'Exportação CSV de vendas',
};

/** Rótulos amigáveis para campos comuns em PATCH/POST. */
const FIELD_LABELS: Record<string, string> = {
  name: 'nome',
  username: 'login',
  email: 'e-mail',
  phone: 'telefone',
  document: 'CPF/CNPJ',
  creditLimit: 'limite de crédito',
  requisitionLimit: 'limite de requisição',
  street: 'logradouro',
  number: 'número',
  complement: 'complemento',
  district: 'bairro',
  city: 'cidade',
  state: 'UF',
  zip: 'CEP',
  segment: 'grupo',
  notes: 'observações',
  birthDate: 'data de nascimento',
  isActive: 'ativo',
  profile: 'perfil',
  legalName: 'razão social',
  tradeName: 'nome fantasia',
  sku: 'SKU',
  barcode: 'código de barras',
  retailPrice: 'preço varejo',
  wholesalePrice: 'preço atacado',
  promoPrice: 'preço promoção',
  costAverage: 'custo médio',
  minStock: 'estoque mínimo',
  description: 'descrição',
  amount: 'valor',
  amountRemaining: 'saldo',
  dueDate: 'vencimento',
  openingBalance: 'fundo de troco',
  closingBalance: 'saldo de fechamento',
  closingByMethod: 'valores apresentados',
  closingNotes: 'observações do fechamento',
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  PIX: 'PIX',
  CREDIT: 'Crediário',
  REQUISITION: 'Requisição',
  OTHER: 'Outros',
  EXPENSE: 'Despesas',
};

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'confirmPassword',
  'managerPassword',
  'permissionPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
]);

export function parseApiPath(url: string): { segments: string[]; subPath: string } {
  const path = url.split('?')[0] ?? '';
  const normalized = path.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const segments = normalized ? normalized.split('/').filter(Boolean) : [];
  const subPath = segments.slice(1).join('/');
  return { segments, subPath };
}

export function crudActionFromMethod(method: string): ActivityLogAction | null {
  if (method === 'POST') return ActivityLogAction.CREATE;
  if (method === 'PATCH' || method === 'PUT') return ActivityLogAction.UPDATE;
  if (method === 'DELETE') return ActivityLogAction.DELETE;
  return null;
}

export function entityLabelForResource(resource: string): string {
  return ENTITY_LABELS[resource] ?? resource.replace(/-/g, ' ');
}

export function reportSummaryFromPath(segments: string[]): string | null {
  if (segments[0] !== 'reports') return null;
  const slug = segments.slice(1).join('/') || 'relatório';
  const title = REPORT_LABELS[slug] ?? slug.replace(/\//g, ' · ').replace(/-/g, ' ');
  return `Gerou relatório — ${title}`;
}

function queryString(url: string): string {
  const i = url.indexOf('?');
  return i >= 0 ? url.slice(i + 1) : '';
}

function hasQuery(url: string): boolean {
  return queryString(url).length > 0;
}

/** Detecta GETs de impressão/relatório fora de `/reports/*` (financeiro, caixa, balanço, estoque). */
export function detectReportGet(
  segments: string[],
  url: string,
): { summary: string; entityRef: string | null } | null {
  const qs = queryString(url);

  if (segments[0] === 'reports') {
    const summary = reportSummaryFromPath(segments);
    if (!summary) return null;
    return {
      summary,
      entityRef: segments.slice(1).join('/') || null,
    };
  }

  if (segments[0] === 'finance' && (segments[1] === 'payables' || segments[1] === 'receivables')) {
    const kind = segments[1] === 'payables' ? 'Contas a pagar' : 'Contas a receber';
    if (segments[2] && segments.length === 3) {
      return {
        summary: `Gerou relatório — ${kind} (detalhe do título)`,
        entityRef: null,
      };
    }
    if (segments.length === 2 && hasQuery(url)) {
      const params = new URLSearchParams(qs);
      let mode = 'listagem filtrada';
      if (params.get('statusIn')?.includes('OPEN')) mode = 'títulos em aberto';
      else if (params.get('status') === 'PAID') mode = 'títulos liquidados';
      const from = params.get('from');
      const to = params.get('to');
      const period =
        from && to ? ` (${from} a ${to})` : from ? ` (desde ${from})` : to ? ` (até ${to})` : '';
      return {
        summary: `Gerou relatório — ${kind} — ${mode}${period}`,
        entityRef: null,
      };
    }
    return null;
  }

  if (segments[0] === 'cash' && segments[1] === 'report') {
    const title = segments[2] === 'items' ? 'Itens vendidos (caixa)' : 'Relatório de caixa';
    return {
      summary: `Gerou relatório — ${title}`,
      entityRef: null,
    };
  }

  if (segments[0] === 'financial-overview' && segments[1] === 'summary' && hasQuery(url)) {
    return {
      summary: 'Gerou relatório — Balanço financeiro por período',
      entityRef: null,
    };
  }

  if (segments[0] === 'stock-movements' && segments[1] === 'report') {
    return {
      summary: 'Gerou relatório — Movimentações de estoque',
      entityRef: null,
    };
  }

  return null;
}

export function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function formatMoneyLike(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatLogValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '(vazio)';
  if (typeof raw === 'boolean') return raw ? 'sim' : 'não';
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? String(raw) : formatMoneyLike(raw);
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return '(vazio)';
    if (/^-?\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (!Number.isNaN(n) && t.includes('.')) return formatMoneyLike(n);
    }
    return t.length > 80 ? `${t.slice(0, 77)}…` : t;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(o)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      const label = FIELD_LABELS[k] ?? k;
      parts.push(`${label}=${formatLogValue(v)}`);
    }
    return parts.length ? parts.join(', ') : '(objeto)';
  }
  if (Array.isArray(raw)) {
    return raw.length ? `[${raw.length} item(ns)]` : '(lista vazia)';
  }
  return String(raw).slice(0, 80);
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
}

/** Lista campos enviados no body (inclusão ou alteração). */
export function describeRequestFields(
  body: unknown,
  opts?: { maxFields?: number; asUpdate?: boolean },
): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const maxFields = opts?.maxFields ?? 12;
  const asUpdate = opts?.asUpdate ?? false;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(o)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (key === 'managerPassword' || key === 'permissionPassword') continue;
    if (value === undefined) continue;
    if (
      (key === 'id' || key.endsWith('Id') || key.endsWith('Ids')) &&
      typeof value === 'string' &&
      looksLikeUuid(value)
    ) {
      continue;
    }
    const label = fieldLabel(key);
    const formatted = formatLogValue(value);
    parts.push(asUpdate ? `${label} alterado para ${formatted}` : `${label}: ${formatted}`);
    if (parts.length >= maxFields) break;
  }
  return parts.length ? parts.join('; ') : null;
}

/** Compara mapas (ex.: closingByMethod) e retorna "campo de A para B". */
export function describeMapChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts?: { valuePrefix?: string },
): string | null {
  const prev = before ?? {};
  const next = after ?? {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const parts: string[] = [];
  const prefix = opts?.valuePrefix ?? '';
  for (const key of [...keys].sort()) {
    if (SENSITIVE_KEYS.has(key)) continue;
    const a = prev[key];
    const b = next[key];
    const sa = formatLogValue(a);
    const sb = formatLogValue(b);
    if (sa === sb) continue;
    const label = fieldLabel(key);
    parts.push(`${label} alterado de ${prefix}${sa} para ${prefix}${sb}`);
  }
  return parts.length ? parts.join('; ') : null;
}

/** Lista valores por forma de pagamento (fechamento / apresentados). */
export function describePaymentMethodAmounts(
  map: Record<string, unknown> | null | undefined,
): string | null {
  if (!map || typeof map !== 'object') return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    parts.push(`${fieldLabel(key)}: R$ ${formatLogValue(value)}`);
  }
  return parts.length ? parts.join('; ') : null;
}

export function pickEntityRef(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (typeof o.controlNumber === 'number') return `controle ${o.controlNumber}`;
  if (typeof o.controlNumber === 'string' && o.controlNumber.trim()) {
    return `controle ${o.controlNumber.trim()}`;
  }
  if (typeof o.number === 'number') return `#${o.number}`;
  if (typeof o.sku === 'string' && o.sku.trim()) return o.sku.trim().slice(0, 80);
  if (typeof o.legalName === 'string' && o.legalName.trim()) return o.legalName.trim().slice(0, 80);
  if (typeof o.tradeName === 'string' && o.tradeName.trim()) return o.tradeName.trim().slice(0, 80);
  if (typeof o.name === 'string' && o.name.trim()) return o.name.trim().slice(0, 80);
  if (typeof o.email === 'string' && o.email.trim()) return o.email.trim().slice(0, 80);
  // Evita gravar UUID cru (parece “criptografado” na tela de logs).
  if (typeof o.id === 'string' && !looksLikeUuid(o.id)) return o.id.slice(0, 36);
  return null;
}

export function buildCrudSummary(params: {
  action: ActivityLogAction;
  resource: string;
  subPath: string;
  entityRef: string | null;
  requestBody?: unknown;
}): string {
  const label = entityLabelForResource(params.resource);
  const ref = params.entityRef ? ` ${params.entityRef}` : '';
  const isUpdate = params.action === ActivityLogAction.UPDATE;
  const fields = describeRequestFields(params.requestBody, { asUpdate: isUpdate });

  if (params.subPath.endsWith('/pay')) {
    return `Baixou conta a pagar${ref}`;
  }
  if (params.subPath.endsWith('/receive')) {
    return `Baixou conta a receber${ref}`;
  }
  if (params.subPath.includes('/cancel')) {
    return `Cancelou venda${ref}`;
  }
  if (params.subPath.includes('/remove')) {
    return `Removeu item de venda${ref}`;
  }

  switch (params.action) {
    case ActivityLogAction.CREATE:
      return fields ? `Incluiu ${label}${ref} — ${fields}` : `Incluiu ${label}${ref}`;
    case ActivityLogAction.UPDATE:
      return fields
        ? `Alterou ${label}${ref} — ${fields}`
        : `Alterou ${label}${ref}`;
    case ActivityLogAction.DELETE:
      return `Excluiu ${label}${ref}`;
    default:
      return `${label}${ref}`;
  }
}

export const MUTATION_SKIP_PREFIXES = [
  'auth',
  'activity-logs',
  'health',
  'branding',
  'portal',
  'wachat',
  'dashboard',
  'fiscal/inbound',
  'fiscal/documents',
];

export function shouldSkipMutationLog(segments: string[], method: string): boolean {
  if (!segments.length) return true;
  const head = segments.slice(0, 2).join('/');
  const head1 = segments[0] ?? '';

  if (head1 === 'sales' && method === 'POST' && segments.length === 1) return true;
  // Caixa: logs manuais (abertura/fechamento/apresentados) — evita ruído genérico.
  if (head1 === 'cash') return true;

  if (MUTATION_SKIP_PREFIXES.includes(head1)) return true;
  if (MUTATION_SKIP_PREFIXES.includes(head)) return true;
  return false;
}
