import { getToken } from './api';

/**
 * Perfis "amigáveis" expostos no UI. Mapeiam para roles RBAC do backend.
 *  - manager     → roles internas `admin` ou `manager`
 *  - cashier     → role interna `seller`
 *  - waiter      → role interna `waiter` (só Salão)
 *  - technician  → role interna `technician` (Ordens de Serviço)
 */
export type UserProfile = 'manager' | 'cashier' | 'waiter' | 'technician';

export type PlanCode = 'STANDARD' | 'WHATSAPP' | 'RESTAURANT';

export type TenantModuleAddon = 'SERVICE_ORDER';

export type JwtIdentity = {
  sub: string;
  email: string;
  tenantSlug: string;
  roles: string[];
  planCode?: PlanCode;
  enabledModules?: TenantModuleAddon[];
};

/**
 * Decodifica o payload de um JWT (parte central, base64url) sem validação de
 * assinatura — válido para uso somente como dica de UI. As verificações de
 * acesso reais acontecem no backend.
 */
function decodeJwt(token: string): JwtIdentity | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const json = atob(padded);
    const obj = JSON.parse(json) as Partial<JwtIdentity>;
    if (!obj || typeof obj.sub !== 'string') return null;
    return {
      sub: obj.sub,
      email: typeof obj.email === 'string' ? obj.email : '',
      tenantSlug: typeof obj.tenantSlug === 'string' ? obj.tenantSlug : '',
      roles: Array.isArray(obj.roles) ? obj.roles.filter((r): r is string => typeof r === 'string') : [],
      planCode:
        obj.planCode === 'STANDARD' || obj.planCode === 'WHATSAPP' || obj.planCode === 'RESTAURANT'
          ? obj.planCode
          : undefined,
      enabledModules: Array.isArray(obj.enabledModules)
        ? obj.enabledModules.filter((m): m is TenantModuleAddon => m === 'SERVICE_ORDER')
        : undefined,
    };
  } catch {
    return null;
  }
}

export function getIdentity(): JwtIdentity | null {
  const token = getToken();
  if (!token) return null;
  return decodeJwt(token);
}

export function profileFromRoles(roles: string[]): UserProfile {
  if (roles.includes('admin') || roles.includes('manager')) return 'manager';
  if (roles.includes('technician') && !roles.includes('seller')) return 'technician';
  if (roles.includes('waiter') && !roles.includes('seller')) return 'waiter';
  return 'cashier';
}

export function profileLabel(profile: UserProfile): string {
  if (profile === 'manager') return 'Gerente';
  if (profile === 'waiter') return 'Garçom';
  if (profile === 'technician') return 'Técnico';
  return 'Caixa';
}

export function isWaiter(): boolean {
  return profileFromRoles(getIdentity()?.roles ?? []) === 'waiter';
}

export function isTechnician(): boolean {
  return profileFromRoles(getIdentity()?.roles ?? []) === 'technician';
}

export function isManager(): boolean {
  const id = getIdentity();
  if (!id) return false;
  return id.roles.includes('admin') || id.roles.includes('manager');
}

/** Role interna `admin` (Administrador) — acima do perfil “Gerente” (`manager`). */
export function isAdmin(): boolean {
  const id = getIdentity();
  if (!id) return false;
  return id.roles.includes('admin');
}

/** Plano contratado (JWT). Sem planCode no token antigo → STANDARD. */
export function getPlanCode(): PlanCode {
  const id = getIdentity();
  return id?.planCode ?? 'STANDARD';
}

/** Menu/rotas do módulo restaurante: plano RESTAURANT (flag da empresa é checada nas APIs). */
export function hasRestaurantPlan(): boolean {
  return getPlanCode() === 'RESTAURANT';
}

/** Addon Ordem de Serviços no portal (JWT enabledModules). */
export function hasServiceOrderModule(): boolean {
  const mods = getIdentity()?.enabledModules ?? [];
  return mods.includes('SERVICE_ORDER');
}
