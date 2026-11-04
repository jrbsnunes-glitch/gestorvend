import { PdvTerminalRole } from '../generated/tenant-client';

export type PdvTerminalCapabilities = {
  canOpenCash: boolean;
  canCloseCash: boolean;
  canPdvProcedures: boolean;
  /** Consultar / reimprimir vendas recentes (mestre e secundário). */
  canViewRecentSales: boolean;
  /** Cancelar linha, enfileirar NF, liberar erro fiscal — só PDV mestre + gerente. */
  canManagePastSales: boolean;
  isSatellite: boolean;
};

export function capabilitiesFromRole(role: PdvTerminalRole): PdvTerminalCapabilities {
  const isPrimary = role === PdvTerminalRole.PRIMARY;
  return {
    canOpenCash: isPrimary,
    canCloseCash: isPrimary,
    canPdvProcedures: isPrimary,
    canViewRecentSales: true,
    canManagePastSales: isPrimary,
    isSatellite: !isPrimary,
  };
}
