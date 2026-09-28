import { PdvTerminalRole } from '../generated/tenant-client';

export type PdvTerminalCapabilities = {
  canOpenCash: boolean;
  canCloseCash: boolean;
  canPdvProcedures: boolean;
  canManagePastSales: boolean;
  isSatellite: boolean;
};

export function capabilitiesFromRole(role: PdvTerminalRole): PdvTerminalCapabilities {
  const isPrimary = role === PdvTerminalRole.PRIMARY;
  return {
    canOpenCash: isPrimary,
    canCloseCash: isPrimary,
    canPdvProcedures: isPrimary,
    canManagePastSales: isPrimary,
    isSatellite: !isPrimary,
  };
}
