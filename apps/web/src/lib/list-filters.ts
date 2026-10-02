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

/** Data local no formato AAAA-MM-DD (evita deslocamento de `toISOString()`). */
export function localDateInputFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocalDateInput(): string {
  return localDateInputFromDate(new Date());
}

export function daysAgoLocalDateInput(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateInputFromDate(d);
}

/** Primeiro e último dia do mês corrente (calendário local). */
export function monthRangeLocal(): { from: string; to: string } {
  const n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth(), 1);
  const end = new Date(n.getFullYear(), n.getMonth() + 1, 0);
  return { from: localDateInputFromDate(start), to: localDateInputFromDate(end) };
}

/** Valida `YYYY-MM-DD` digitado em filtros. */
export function parseFilterDateInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(y, mo - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
  return d.getTime();
}

/** Mensagem de erro ou `null` se o período (parcial ou completo) for válido. */
export function validateFilterPeriodRange(from: string, to: string): string | null {
  const fromT = parseFilterDateInput(from);
  const toT = parseFilterDateInput(to);
  if (from.trim() && fromT == null) return 'Data inicial inválida. Use o formato AAAA-MM-DD.';
  if (to.trim() && toT == null) return 'Data final inválida. Use o formato AAAA-MM-DD.';
  if (fromT != null && toT != null && fromT > toT) {
    return 'A data inicial deve ser anterior ou igual à data final.';
  }
  return null;
}

export function trimFilterPeriod(from: string, to: string): { from: string; to: string } {
  return { from: from.trim(), to: to.trim() };
}

export function applyControlRangeSlice<T>(items: T[], minRaw: string, maxRaw: string): T[] {
  if (!controlRangeActive({ controlMin: minRaw, controlMax: maxRaw })) return items;
  return items.filter((_, idx) => matchesListControlIndex(idx, minRaw, maxRaw));
}
