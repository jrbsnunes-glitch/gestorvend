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
};

const REPORT_LABELS: Record<string, string> = {
  'sales-summary': 'Resumo de vendas',
  'stock-position': 'Posição de estoque',
  'stock-daily': 'Estoque diário',
  'product-movements': 'Movimentação de produtos',
  'product-turnover': 'Giro de produtos',
  'export/sales.csv': 'Exportação CSV de vendas',
};

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
        entityRef: segments[2],
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
        entityRef: qs.slice(0, 200) || null,
      };
    }
    return null;
  }

  if (segments[0] === 'cash' && segments[1] === 'report') {
    const title = segments[2] === 'items' ? 'Itens vendidos (caixa)' : 'Relatório de caixa';
    return {
      summary: `Gerou relatório — ${title}`,
      entityRef: qs.slice(0, 200) || null,
    };
  }

  if (segments[0] === 'financial-overview' && segments[1] === 'summary' && hasQuery(url)) {
    return {
      summary: 'Gerou relatório — Balanço financeiro por período',
      entityRef: qs.slice(0, 200) || null,
    };
  }

  if (segments[0] === 'stock-movements' && segments[1] === 'report') {
    return {
      summary: 'Gerou relatório — Movimentações de estoque',
      entityRef: qs.slice(0, 200) || null,
    };
  }

  return null;
}

export function pickEntityRef(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (typeof o.number === 'number') return `#${o.number}`;
  if (typeof o.controlNumber === 'number') return `#${o.controlNumber}`;
  if (typeof o.sku === 'string' && o.sku.trim()) return o.sku.trim().slice(0, 80);
  if (typeof o.legalName === 'string' && o.legalName.trim()) return o.legalName.trim().slice(0, 80);
  if (typeof o.name === 'string' && o.name.trim()) return o.name.trim().slice(0, 80);
  if (typeof o.email === 'string' && o.email.trim()) return o.email.trim().slice(0, 80);
  if (typeof o.id === 'string') return o.id.slice(0, 36);
  return null;
}

export function buildCrudSummary(params: {
  action: ActivityLogAction;
  resource: string;
  subPath: string;
  entityRef: string | null;
}): string {
  const label = entityLabelForResource(params.resource);
  const ref = params.entityRef ? ` (${params.entityRef})` : '';

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
      return `Incluiu ${label}${ref}`;
    case ActivityLogAction.UPDATE:
      return `Alterou ${label}${ref}`;
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
  if (head1 === 'cash') return true;

  if (MUTATION_SKIP_PREFIXES.includes(head1)) return true;
  if (MUTATION_SKIP_PREFIXES.includes(head)) return true;
  return false;
}
