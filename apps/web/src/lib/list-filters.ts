/** Filtros numéricos de controle (coluna Cont. ou número sequencial do registro). */
export type ControlRangeFilter = {
  controlMin: string;
  controlMax: string;
};

export const EMPTY_CONTROL_RANGE: ControlRangeFilter = {
  controlMin: '',
  controlMax: '',
};

export function parseOptionalControlInt(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function controlRangeActive(f: ControlRangeFilter): boolean {
  return f.controlMin.trim() !== '' || f.controlMax.trim() !== '';
}

/** Valor de controle explícito (nº OS, requisição, caixa…). */
export function matchesControlValue(value: number, minRaw: string, maxRaw: string): boolean {
  const min = parseOptionalControlInt(minRaw);
  const max = parseOptionalControlInt(maxRaw);
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

/** Posição 1-based na listagem já filtrada (coluna Cont. em cadastros). */
export function matchesListControlIndex(indexZeroBased: number, minRaw: string, maxRaw: string): boolean {
  return matchesControlValue(indexZeroBased + 1, minRaw, maxRaw);
}

export function dateInInclusiveRange(iso: string, from: string, to: string): boolean {
  const day = iso.slice(0, 10);
  if (from.trim() && day < from.trim()) return false;
  if (to.trim() && day > to.trim()) return false;
  return true;
}

export function applyControlRangeSlice<T>(items: T[], minRaw: string, maxRaw: string): T[] {
  if (!controlRangeActive({ controlMin: minRaw, controlMax: maxRaw })) return items;
  return items.filter((_, idx) => matchesListControlIndex(idx, minRaw, maxRaw));
}
