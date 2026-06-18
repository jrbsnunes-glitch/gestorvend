/** Formato: UNIDADE-FATOR (ex.: CX-12). */
export function parseProductConversion(
  spec: string | null | undefined,
): { unit: string; factor: number } | null {
  const raw = (spec ?? '').trim();
  if (!raw) return null;
  const m = raw.match(/^([A-Za-z]+)-(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const factor = parseFloat(m[2]!);
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return { unit: m[1]!.toUpperCase(), factor };
}

export function previewStockFromInvoice(
  invoiceQty: number,
  invoiceUnit: string | null | undefined,
  conversion: string | null | undefined,
): { quantity: number; converted: boolean } {
  const parsed = parseProductConversion(conversion);
  const unitNorm = (invoiceUnit ?? '').trim().toUpperCase();
  if (parsed && unitNorm && unitNorm === parsed.unit) {
    return { quantity: invoiceQty * parsed.factor, converted: true };
  }
  return { quantity: invoiceQty, converted: false };
}

export function formatConversionHint(
  invoiceQty: number,
  invoiceUnit: string | null | undefined,
  conversion: string | null | undefined,
): string | null {
  const parsed = parseProductConversion(conversion);
  const unitNorm = (invoiceUnit ?? '').trim().toUpperCase();
  if (!parsed || !unitNorm || unitNorm !== parsed.unit) return null;
  const stockQty = invoiceQty * parsed.factor;
  return `${invoiceQty} ${unitNorm} × ${parsed.factor} = ${stockQty} un. no estoque`;
}
