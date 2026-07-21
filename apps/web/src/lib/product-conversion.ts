/**
 * Conversão digitada pelo usuário (como na NF-e): CX-12, CX24, CX-6, PCT-10, PCT…
 */
export type ParsedProductConversion = {
  token: string;
  unit: string;
  factor: number;
};

function normalizeUnitToken(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function factorToken(factor: number): string {
  return String(Number(factor));
}

export function parseProductConversion(
  spec: string | null | undefined,
): ParsedProductConversion | null {
  const raw = normalizeUnitToken(spec);
  if (!raw) return null;

  const withFactor = raw.match(/^([A-Z]+)(?:-)?(\d+(?:\.\d+)?)$/);
  if (withFactor) {
    const factor = parseFloat(withFactor[2]!);
    if (!Number.isFinite(factor) || factor <= 0) return null;
    return { token: raw, unit: withFactor[1]!, factor };
  }

  const unitOnly = raw.match(/^([A-Z]+)$/);
  if (unitOnly) {
    return { token: raw, unit: unitOnly[1]!, factor: 1 };
  }

  return null;
}

/** Preserva o formato digitado (CX24 não vira CX-24). */
export function normalizeProductConversion(
  spec: string | null | undefined,
): string | null {
  const parsed = parseProductConversion(spec);
  return parsed ? parsed.token : null;
}

export function invoiceUnitMatchesConversion(
  invoiceUnit: string | null | undefined,
  conversion: string | null | undefined,
): boolean {
  const parsed = parseProductConversion(conversion);
  if (!parsed) return false;
  const unitNorm = normalizeUnitToken(invoiceUnit);
  if (!unitNorm) return false;

  const factor = factorToken(parsed.factor);
  const dashed = `${parsed.unit}-${factor}`;
  const compact = `${parsed.unit}${factor}`;
  const invCompact = unitNorm.replace(/-/g, '');
  const convCompact = parsed.token.replace(/-/g, '');

  return (
    unitNorm === parsed.token ||
    unitNorm === parsed.unit ||
    unitNorm === dashed ||
    unitNorm === compact ||
    invCompact === convCompact ||
    (parsed.factor > 1 && invCompact === `${parsed.unit}${factor}`)
  );
}

export function previewStockFromInvoice(
  invoiceQty: number,
  invoiceUnit: string | null | undefined,
  conversion: string | null | undefined,
): { quantity: number; converted: boolean } {
  const parsed = parseProductConversion(conversion);
  if (parsed && invoiceUnitMatchesConversion(invoiceUnit, conversion)) {
    return {
      quantity: invoiceQty * parsed.factor,
      converted: parsed.factor !== 1,
    };
  }
  return { quantity: invoiceQty, converted: false };
}

export function formatConversionHint(
  invoiceQty: number,
  invoiceUnit: string | null | undefined,
  conversion: string | null | undefined,
): string | null {
  const parsed = parseProductConversion(conversion);
  if (!parsed || !invoiceUnitMatchesConversion(invoiceUnit, conversion)) return null;
  if (parsed.factor === 1) {
    return `Unidade da NF (${normalizeUnitToken(invoiceUnit)}) confere com a conversão ${parsed.token}`;
  }
  const stockQty = invoiceQty * parsed.factor;
  const unitLabel = normalizeUnitToken(invoiceUnit) || parsed.token;
  return `${invoiceQty} ${unitLabel} × ${parsed.factor} = ${stockQty} un. no estoque`;
}
