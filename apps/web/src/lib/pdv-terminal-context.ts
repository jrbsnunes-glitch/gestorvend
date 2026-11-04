import { isGestorVendDesktop } from './desktop-bridge';

const PDV_TERMINAL_NUMBER_KEY = 'gv-pdv-terminal-number';

export function getPdvTerminalNumber(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PDV_TERMINAL_NUMBER_KEY);
    if (!raw) return null;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 1 ? n : null;
  } catch {
    return null;
  }
}

export function setPdvTerminalNumber(number: number | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (number == null || !Number.isFinite(number) || number < 1) {
      sessionStorage.removeItem(PDV_TERMINAL_NUMBER_KEY);
    } else {
      sessionStorage.setItem(PDV_TERMINAL_NUMBER_KEY, String(Math.floor(number)));
    }
  } catch {
    /* ignore */
  }
}

export function readTerminalFromUrl(search: string): number | null {
  const n = Math.floor(Number(new URLSearchParams(search).get('terminal')));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export type PdvTerminalCapabilities = {
  canOpenCash: boolean;
  canCloseCash: boolean;
  canPdvProcedures: boolean;
  canViewRecentSales: boolean;
  canManagePastSales: boolean;
  isSatellite: boolean;
};

export const FULL_PDV_CAPABILITIES: PdvTerminalCapabilities = {
  canOpenCash: true,
  canCloseCash: true,
  canPdvProcedures: true,
  canViewRecentSales: true,
  canManagePastSales: true,
  isSatellite: false,
};

/** Desktop pareado como PDV operador (mestre ou secundário). */
export function isDesktopPdvStation(terminalNumber: number | null): boolean {
  return isGestorVendDesktop() && terminalNumber != null;
}

/**
 * PDV secundário: sem fechar caixa, procedimentos nem gestão de vendas passadas.
 * Vendas recentes (consulta/reimpressão) permanecem disponíveis.
 */
export function withDesktopCashierLimits(
  caps: PdvTerminalCapabilities,
  _terminalNumber: number | null,
): PdvTerminalCapabilities {
  if (!caps.isSatellite) return caps;
  return {
    ...caps,
    canCloseCash: false,
    canPdvProcedures: false,
    canViewRecentSales: caps.canViewRecentSales !== false,
    canManagePastSales: false,
  };
}
