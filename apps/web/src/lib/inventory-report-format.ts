/** Helpers de query para relatórios de inventário físico. */

export type InventorySummaryFilters = {
  from?: string;
  to?: string;
  locationId?: string;
  status?: string;
  controlMin?: string;
  controlMax?: string;
};

export type InventoryDivergenceFilters = {
  from?: string;
  to?: string;
  locationId?: string;
  inventoryId?: string;
  onlyDiffs?: boolean;
  controlMin?: string;
  controlMax?: string;
};

export function buildInventorySummaryQuery(f: InventorySummaryFilters): string {
  const qs = new URLSearchParams();
  if (f.from?.trim()) qs.set('from', f.from.trim());
  if (f.to?.trim()) qs.set('to', f.to.trim());
  if (f.locationId?.trim()) qs.set('locationId', f.locationId.trim());
  if (f.status?.trim()) qs.set('status', f.status.trim());
  if (f.controlMin?.trim()) qs.set('controlMin', f.controlMin.trim());
  if (f.controlMax?.trim()) qs.set('controlMax', f.controlMax.trim());
  return qs.toString();
}

export function buildInventoryDivergenceQuery(f: InventoryDivergenceFilters): string {
  const qs = new URLSearchParams();
  if (f.inventoryId?.trim()) {
    qs.set('inventoryId', f.inventoryId.trim());
  } else {
    if (f.from?.trim()) qs.set('from', f.from.trim());
    if (f.to?.trim()) qs.set('to', f.to.trim());
    if (f.controlMin?.trim()) qs.set('controlMin', f.controlMin.trim());
    if (f.controlMax?.trim()) qs.set('controlMax', f.controlMax.trim());
  }
  if (f.locationId?.trim()) qs.set('locationId', f.locationId.trim());
  if (f.onlyDiffs === true) qs.set('onlyDiffs', '1');
  return qs.toString();
}

export const INVENTORY_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  POSTED: 'Postado',
  CANCELLED: 'Cancelado',
};

/** Valida intervalo de nº de controle do inventário (opcional). */
export function parseInventoryControlBound(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

/**
 * Aceita só mín. (busca exata #N), só máx. (até #N) ou ambos (intervalo).
 * Vazio nos dois → sem filtro de controle.
 */
export function resolveInventoryControlRange(
  minRaw: string,
  maxRaw: string,
): { ok: true; min?: string; max?: string } | { ok: false; error: string } {
  const min = minRaw.trim() ? parseInventoryControlBound(minRaw) : null;
  const max = maxRaw.trim() ? parseInventoryControlBound(maxRaw) : null;
  if (minRaw.trim() && min == null) {
    return { ok: false, error: 'Controle mín. inválido (use inteiro positivo).' };
  }
  if (maxRaw.trim() && max == null) {
    return { ok: false, error: 'Controle máx. inválido (use inteiro positivo).' };
  }
  if (min == null && max == null) return { ok: true };
  if (min != null && max != null && min > max) {
    return { ok: false, error: 'Controle mín. não pode ser maior que o máx.' };
  }
  const from = min ?? 1;
  const to = max ?? min!;
  return { ok: true, min: String(from), max: String(to) };
}
