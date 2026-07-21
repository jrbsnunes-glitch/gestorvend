/** Rótulos de movimento alinhados à API `/reports/product-movements`. */
export function movementLabel(type: string, source: string): string {
  if (type === 'ADJUST') return 'Ajuste de inventário';
  if (type === 'IN' && source === 'GOODS_RECEIPT') return 'Entrada / NF compra';
  if (type === 'IN' && source === 'TRANSFER') return 'Transferência (entrada)';
  if (type === 'OUT' && source === 'SALE') return 'Venda';
  if (type === 'OUT' && source === 'MANUAL_OUT') return 'Saída manual';
  if (type === 'OUT' && source === 'TRANSFER') return 'Transferência (saída)';
  if (type === 'IN') return 'Entrada (outras)';
  if (type === 'OUT') return 'Saída (outras)';
  return `${type} / ${source}`;
}

/** Valida código sequencial do produto (inteiro positivo). */
export function parseProductCodeBound(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Monta query string para `GET /reports/product-movements`. */
export function buildProductMovementReportQuery(p: {
  variantId?: string;
  minStockCadFrom?: string;
  minStockCadTo?: string;
  categoryId?: string;
  from: string;
  to: string;
  locationId?: string;
  useMinControl: boolean;
  useMaxControl: boolean;
  alertsOnly: boolean;
  /** Quando omitido ou false, SKU sem lançamentos no período ficam de fora (conjunto sem variantId). */
  showNoMovement?: boolean;
  maxStockCeiling: string;
}): string {
  const params = new URLSearchParams({
    from: p.from,
    to: p.to,
    useMinControl: p.useMinControl ? '1' : '0',
    useMaxControl: p.useMaxControl ? '1' : '0',
    alertsOnly: p.alertsOnly ? '1' : '0',
    showNoMovement: p.showNoMovement ? '1' : '0',
  });
  if (p.variantId?.trim()) {
    params.set('variantId', p.variantId.trim());
  } else {
    params.set('minStockCadFrom', String(p.minStockCadFrom ?? '').trim());
    params.set('minStockCadTo', String(p.minStockCadTo ?? '').trim());
  }
  if (p.categoryId?.trim()) params.set('categoryId', p.categoryId.trim());
  if (p.locationId) params.set('locationId', p.locationId);
  if (p.useMaxControl && p.maxStockCeiling.trim()) {
    params.set('maxStockCeiling', p.maxStockCeiling.replace(',', '.'));
  }
  return params.toString();
}

/** Monta query string para `GET /reports/product-turnover`. */
export function buildProductTurnoverReportQuery(p: {
  from: string;
  to: string;
  take: string;
  variantId?: string;
  /** Intervalo de código sequencial do produto. Ambos ou nenhum, com período só = ranking de quem vendeu. */
  minStockCadFrom?: string;
  minStockCadTo?: string;
  categoryId?: string;
  /** Só aplica em modo conjunto (`variantId` ou intervalo de código). Padrão na API: incluir zeros ao omitir o parâmetro. */
  showNoSale?: boolean;
  useMinControl: boolean;
  useMaxControl: boolean;
  alertsOnly: boolean;
  maxStockCeiling: string;
}): string {
  const params = new URLSearchParams({
    from: p.from,
    to: p.to,
    take: p.take.trim() || '80',
    useMinControl: p.useMinControl ? '1' : '0',
    useMaxControl: p.useMaxControl ? '1' : '0',
    alertsOnly: p.alertsOnly ? '1' : '0',
  });
  const vid = p.variantId?.trim();
  const cFrom = String(p.minStockCadFrom ?? '').trim();
  const cTo = String(p.minStockCadTo ?? '').trim();
  if (vid) {
    params.set('variantId', vid);
    params.set('showNoSale', p.showNoSale === false ? '0' : '1');
  } else if (cFrom && cTo) {
    params.set('minStockCadFrom', cFrom);
    params.set('minStockCadTo', cTo);
    params.set('showNoSale', p.showNoSale === false ? '0' : '1');
  }
  if (p.categoryId?.trim()) params.set('categoryId', p.categoryId.trim());
  if (p.useMaxControl && p.maxStockCeiling.trim()) {
    params.set('maxStockCeiling', p.maxStockCeiling.replace(',', '.'));
  }
  return params.toString();
}

export type ProductStockReportKind = 'financial' | 'physical' | 'minimum';

/** Monta query string para relatórios de estoque (financeiro, físico, mínimo). */
export function buildProductStockReportQuery(p: {
  from: string;
  to: string;
  locationId?: string;
  categoryId?: string;
  minStockCadFrom?: string;
  minStockCadTo?: string;
}): string {
  const params = new URLSearchParams({ from: p.from, to: p.to });
  if (p.locationId?.trim()) params.set('locationId', p.locationId.trim());
  if (p.categoryId?.trim()) params.set('categoryId', p.categoryId.trim());
  const cFrom = String(p.minStockCadFrom ?? '').trim();
  const cTo = String(p.minStockCadTo ?? '').trim();
  if (cFrom && cTo) {
    params.set('minStockCadFrom', cFrom);
    params.set('minStockCadTo', cTo);
  }
  return params.toString();
}

export function productStockReportApiPath(kind: ProductStockReportKind): string {
  switch (kind) {
    case 'financial':
      return '/reports/product-financial-stock';
    case 'physical':
      return '/reports/product-physical-stock';
    case 'minimum':
      return '/reports/product-minimum-stock';
  }
}

export function productStockReportTitle(kind: ProductStockReportKind): string {
  switch (kind) {
    case 'financial':
      return 'Estoque financeiro';
    case 'physical':
      return 'Estoque físico';
    case 'minimum':
      return 'Estoque mínimo';
  }
}

export function productStockReportRoute(kind: ProductStockReportKind): string {
  switch (kind) {
    case 'financial':
      return '/produtos/relatorio/estoque-financeiro';
    case 'physical':
      return '/produtos/relatorio/estoque-fisico';
    case 'minimum':
      return '/produtos/relatorio/estoque-minimo';
  }
}
