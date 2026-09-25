import { TenantModuleAddon } from '../generated/central-client';

/** Valores válidos no portal — não depender só do enum Prisma gerado em runtime desatualizado. */
export const PORTAL_MODULE_ADDON_CODES = ['SERVICE_ORDER', 'FACTORY'] as const;

export type PortalModuleAddonCode = (typeof PORTAL_MODULE_ADDON_CODES)[number];

const ADDON_SET = new Set<string>([
  ...PORTAL_MODULE_ADDON_CODES,
  ...Object.values(TenantModuleAddon),
]);

export function normalizePortalModuleAddons(raw: unknown): TenantModuleAddon[] {
  if (!Array.isArray(raw)) return [];
  const out: TenantModuleAddon[] = [];
  for (const item of raw) {
    const s = String(item ?? '').trim().toUpperCase();
    if (ADDON_SET.has(s)) out.push(s as TenantModuleAddon);
  }
  return [...new Set(out)];
}

export function isPortalModuleAddonCode(s: string): s is PortalModuleAddonCode {
  return s === 'SERVICE_ORDER' || s === 'FACTORY';
}
