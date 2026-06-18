/** Formato esperado: UNIDADE-FATOR (ex.: CX-12, UN-1). */
export function parseProductConversion(
  spec: string | null | undefined,
): { unit: string; factor: number } | null {
  const raw = (spec ?? '').trim();
  if (!raw) return null;
  const m = raw.match(/^([A-Za-z]+)-(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const factor = parseFloat(m[2]!);
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return { unit: m[1]!.toUpperCase(), factor };
}

export function validateProductConversion(spec: string | null | undefined): string | null {
  if (spec == null || !String(spec).trim()) return null;
  if (!parseProductConversion(spec)) {
    return 'Conversão inválida. Use o formato UNIDADE-QUANTIDADE (ex.: CX-12).';
  }
  return null;
}

/**
 * Converte quantidade/custo da NF-e para unidades de estoque quando a unidade
 * da nota coincide com a unidade configurada na conversão do produto.
 */
export function resolveStockFromInvoice(
  invoiceQty: number,
  invoiceUnit: string | null | undefined,
  invoiceUnitCost: number,
  conversion: string | null | undefined,
): { quantity: number; unitCost: number; converted: boolean } {
  const parsed = parseProductConversion(conversion);
  const unitNorm = (invoiceUnit ?? '').trim().toUpperCase();
  if (parsed && unitNorm && unitNorm === parsed.unit) {
    return {
      quantity: invoiceQty * parsed.factor,
      unitCost: invoiceUnitCost / parsed.factor,
      converted: true,
    };
  }
  return { quantity: invoiceQty, unitCost: invoiceUnitCost, converted: false };
}
