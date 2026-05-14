import { getToken } from './api';

/**
 * Perfis "amigáveis" expostos no UI. Mapeiam para roles RBAC do backend.
 *  - manager  → roles internas `admin` ou `manager`
 *  - cashier  → role interna `seller`
 */
export type UserProfile = 'manager' | 'cashier';

export type JwtIdentity = {
  sub: string;
  email: string;
  tenantSlug: string;
  roles: string[];
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
  return 'cashier';
}

export function profileLabel(profile: UserProfile): string {
  return profile === 'manager' ? 'Gerente' : 'Caixa';
}

export function isManager(): boolean {
  const id = getIdentity();
  if (!id) return false;
  return id.roles.includes('admin') || id.roles.includes('manager');
}
