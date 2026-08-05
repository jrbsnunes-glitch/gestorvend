/**
 * Preferências locais da estação de impressão (navegador / desktop).
 * Preferível a User-Agent: media query de ponteiro + largura (ver responsive-tables.ts).
 */

const PRINT_STATION_KEY = 'gv_print_station';

/** Dispositivo com toque grosso e viewport estreita — celular/tablet típico. */
export function isMobileLike(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    return coarse && narrow;
  } catch {
    return false;
  }
}

/** Flag local: este navegador/PC é estação de impressão (fallback sem agente). */
export function isLocalPrintStation(): boolean {
  try {
    return localStorage.getItem(PRINT_STATION_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLocalPrintStation(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(PRINT_STATION_KEY, '1');
    else localStorage.removeItem(PRINT_STATION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pode disparar window.print() neste aparelho?
 * - Estação local marcada, ou
 * - Desktop sem toque (pointer fino / largura confortável)
 */
export function canPrintHere(): boolean {
  if (isLocalPrintStation()) return true;
  return !isMobileLike();
}
