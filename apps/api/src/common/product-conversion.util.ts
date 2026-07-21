/**
 * Conversão digitada pelo usuário (como na NF-e): CX-12, CX24, CX-6, PCT-10, PCT…
 * Letras = unidade; número opcional = quantas unidades de estoque por 1 da NF.
 */
export type ParsedProductConversion = {
  /** Token normalizado (ex.: CX24, CX-6, PCT) */
  token: string;
  /** Parte alfabética (ex.: CX, PCT) */
  unit: string;
  /** Fator de estoque; 1 se não houver número no texto */
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

  // CX-12, CX12, CX-6, PCT-10…
  const withFactor = raw.match(/^([A-Z]+)(?:-)?(\d+(?:\.\d+)?)$/);
  if (withFactor) {
    const factor = parseFloat(withFactor[2]!);
    if (!Number.isFinite(factor) || factor <= 0) return null;
    return { token: raw, unit: withFactor[1]!, factor };
  }

  // Só unidade (PCT, CX…) — confere igualdade com a NF; fator 1 (sem multiplicar).
  const unitOnly = raw.match(/^([A-Z]+)$/);
  if (unitOnly) {
    return { token: raw, unit: unitOnly[1]!, factor: 1 };
  }

  return null;
}

/** Mantém o texto do usuário (só normaliza maiúsculas/espaços): CX24 permanece CX24. */
export function normalizeProductConversion(
  spec: string | null | undefined,
): string | null {
  const parsed = parseProductConversion(spec);
  return parsed ? parsed.token : null;
}

export function validateProductConversion(spec: string | null | undefined): string | null {
  if (spec == null || !String(spec).trim()) return null;
  if (!parseProductConversion(spec)) {
    return 'Conversão inválida. Digite como na NF-e (ex.: CX-12, CX24, CX-6, PCT-10 ou PCT).';
  }
  return null;
}

/**
 * Confere a unidade da NF (uCom) com o que o usuário cadastrou na conversão.
 * Aceita igualdade direta e equivalentes (CX ↔ CX-12 ↔ CX12).
 */
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

/**
 * Converte quantidade/custo da NF-e para unidades de estoque quando a unidade
 * da nota coincide com a conversão cadastrada no produto.
 */
export function resolveStockFromInvoice(
  invoiceQty: number,
  invoiceUnit: string | null | undefined,
  invoiceUnitCost: number,
  conversion: string | null | undefined,
): { quantity: number; unitCost: number; converted: boolean } {
  const parsed = parseProductConversion(conversion);
  if (parsed && invoiceUnitMatchesConversion(invoiceUnit, conversion)) {
    if (parsed.factor === 1) {
      return { quantity: invoiceQty, unitCost: invoiceUnitCost, converted: true };
    }
    return {
      quantity: invoiceQty * parsed.factor,
      unitCost: invoiceUnitCost / parsed.factor,
      converted: true,
    };
  }
  return { quantity: invoiceQty, unitCost: invoiceUnitCost, converted: false };
}

/**
 * Quantidade a baixar/devolver no estoque ao vender um produto composto (caixa)
 * vinculado a um SKU unitário. Sem vínculo, baixa 1:1 a quantidade vendida.
 */
export function resolveSaleStockQuantity(
  soldQty: number,
  conversion: string | null | undefined,
  hasStockComponent: boolean,
): number {
  if (!hasStockComponent) return soldQty;
  const parsed = parseProductConversion(conversion);
  if (!parsed) return soldQty;
  return soldQty * parsed.factor;
}
