/**
 * Conversão digitada pelo usuário (como na NF-e): CX-12, CX24, CX-6, PCT-10, PCT…
 * Letras = unidade; número opcional = quantas unidades de estoque por 1 da NF.
 * Preferir o campo explícito `packItemQty` quando informado.
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

/** Normaliza quantidade de itens por composto (12, 50…). Null se vazio/inválido. */
export function normalizePackItemQty(
  value: number | string | null | undefined,
): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function validatePackItemQty(
  value: number | string | null | undefined,
): string | null {
  if (value == null || value === '') return null;
  if (normalizePackItemQty(value) == null) {
    return 'Quantidade de itens por composto inválida. Informe um número maior que zero (ex.: 12, 50).';
  }
  return null;
}

/**
 * Fator efetivo: `packItemQty` explícito tem prioridade; senão o número embutido
 * em `conversion` (CX-12 → 12); senão 1.
 */
export function resolveConversionFactor(
  conversion: string | null | undefined,
  packItemQty?: number | string | null,
): number {
  const explicit = normalizePackItemQty(packItemQty);
  if (explicit != null) return explicit;
  const parsed = parseProductConversion(conversion);
  return parsed?.factor ?? 1;
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
 * `packItemQty` (itens por caixa) tem prioridade sobre o fator embutido na conversão.
 */
export function resolveStockFromInvoice(
  invoiceQty: number,
  invoiceUnit: string | null | undefined,
  invoiceUnitCost: number,
  conversion: string | null | undefined,
  packItemQty?: number | string | null,
): { quantity: number; unitCost: number; converted: boolean } {
  const parsed = parseProductConversion(conversion);
  if (parsed && invoiceUnitMatchesConversion(invoiceUnit, conversion)) {
    const factor = resolveConversionFactor(conversion, packItemQty);
    if (factor === 1) {
      return { quantity: invoiceQty, unitCost: invoiceUnitCost, converted: true };
    }
    return {
      quantity: invoiceQty * factor,
      unitCost: invoiceUnitCost / factor,
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
  packItemQty?: number | string | null,
): number {
  if (!hasStockComponent) return soldQty;
  const factor = resolveConversionFactor(conversion, packItemQty);
  return soldQty * factor;
}
