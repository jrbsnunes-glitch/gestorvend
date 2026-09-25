import { portalApi } from './portal-api';

export type PortalClientAddon = 'SERVICE_ORDER' | 'FACTORY';

function onlyDigitsCnpj(s: string): string {
  return String(s ?? '').replace(/\D+/g, '');
}

/** API antiga ou proxy sem rota dedicada de módulos. */
export function isPortalModulesRouteMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/\/modules\b/i.test(msg)) return true;
  return /Cannot PATCH|404|Not Found/i.test(msg);
}

type LicensePatchBody = Record<string, unknown>;

/**
 * Salva addons: preferência PATCH /modules (API ≥ v1.0.92).
 * Se a rota não existir (API desatualizada), repete enabledAddons no PATCH /license.
 */
export async function patchPortalClientModules<T extends { cnpj: string }>(
  cnpj: string,
  modules: PortalClientAddon[],
  licenseFallbackBody?: LicensePatchBody,
): Promise<T> {
  const digits = onlyDigitsCnpj(cnpj);
  try {
    return await portalApi<T>(`/portal/clients/${digits}/modules`, {
      method: 'PATCH',
      json: { modules },
    });
  } catch (e) {
    if (!isPortalModulesRouteMissing(e)) throw e;
    return portalApi<T>(`/portal/clients/${digits}/license`, {
      method: 'PATCH',
      json: {
        ...(licenseFallbackBody ?? {}),
        enabledAddons: modules,
      },
    });
  }
}
