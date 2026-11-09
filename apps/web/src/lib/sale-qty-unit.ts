/**
 * Quantidade no PDV e na reserva: lê a unidade do cadastro do produto (`taxUnit`).
 * Metro e peso (e volume) aceitam casas decimais; peça, unidade, caixa etc. ficam inteiras.
 */

const FRACTIONAL_SALE_UNITS = new Set([
  'KG',
  'KGS',
  'QUILO',
  'KILO',
  'G',
  'GR',
  'GRAMA',
  'MG',
  'T',
  'TON',
  'TONELADA',
  'M',
  'MT',
  'MTS',
  'METRO',
  'METROS',
  'M2',
  'MT2',
  'M²',
  'M3',
  'MT3',
  'M³',
  'L',
  'LT',
  'LITRO',
  'ML',
]);

export function normalizeSaleUnit(taxUnit: string | null | undefined): string {
  const u = (taxUnit ?? 'UN')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return u || 'UN';
}

export function isFractionalSaleUnit(taxUnit: string | null | undefined): boolean {
  return FRACTIONAL_SALE_UNITS.has(normalizeSaleUnit(taxUnit));
}

export function qtyStepForUnit(taxUnit: string | null | undefined): number {
  const u = normalizeSaleUnit(taxUnit);
  if (u === 'G' || u === 'GR' || u === 'GRAMA' || u === 'MG' || u === 'ML') return 1;
  if (isFractionalSaleUnit(u)) return 0.1;
  return 1;
}

export function qtyUnitLabel(taxUnit: string | null | undefined): string {
  const u = normalizeSaleUnit(taxUnit);
  if (u === 'KG' || u === 'KGS' || u === 'QUILO' || u === 'KILO') return 'kg';
  if (u === 'G' || u === 'GR' || u === 'GRAMA') return 'g';
  if (u === 'MG') return 'mg';
  if (u === 'T' || u === 'TON' || u === 'TONELADA') return 't';
  if (u === 'M' || u === 'MT' || u === 'MTS' || u === 'METRO' || u === 'METROS') return 'm';
  if (u === 'M2' || u === 'MT2' || u === 'M²') return 'm²';
  if (u === 'M3' || u === 'MT3' || u === 'M³') return 'm³';
  if (u === 'L' || u === 'LT' || u === 'LITRO') return 'L';
  if (u === 'ML') return 'ml';
  return u.toLowerCase();
}

/** 3 casas para metro/peso/volume; inteiro para UN, PC, CX etc. */
export function roundSaleQty(qty: number, taxUnit: string | null | undefined): number {
  if (!Number.isFinite(qty) || qty < 0) return 0;
  if (isFractionalSaleUnit(taxUnit)) {
    return Math.round(qty * 1000) / 1000;
  }
  return Math.round(qty);
}

export function formatSaleQty(qty: number, taxUnit: string | null | undefined): string {
  if (isFractionalSaleUnit(taxUnit)) {
    return qty.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  }
  return String(Math.round(qty));
}
