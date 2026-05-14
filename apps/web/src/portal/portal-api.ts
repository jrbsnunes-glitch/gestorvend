/**
 * Cliente de API isolado para o portal de licenciamento.
 *
 * Mantém um token separado em `localStorage` (`portal_token`) para não
 * conflitar com o JWT do tenant — assim o operador pode ter as duas sessões
 * abertas simultaneamente em abas diferentes do mesmo navegador.
 */

const TOKEN_KEY = 'portal_token';
const ME_KEY = 'portal_me';

export type PortalMe = { id: string; email: string; name: string };

export function getPortalToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setPortalToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getPortalMe(): PortalMe | null {
  const raw = localStorage.getItem(ME_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortalMe;
  } catch {
    return null;
  }
}

export function setPortalMe(me: PortalMe | null): void {
  if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
  else localStorage.removeItem(ME_KEY);
}

/**
 * Mesma convenção de `lib/api.ts`: o Nest usa prefixo global `/api` e, em dev,
 * o Vite só faz proxy de `/api` → 127.0.0.1:3000. Sem o `/api` o POST cai no
 * Vite e vira "Cannot POST /portal/...".
 */
function resolvePortalUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const base = typeof raw === 'string' ? raw.trim() : '';
  const p = path.startsWith('/') ? path : `/${path}`;
  if (base) {
    return `${base.replace(/\/$/, '')}/api${p}`;
  }
  return `/api${p}`;
}

export async function portalApi<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers: HeadersInit = {
    ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  };
  const token = getPortalToken();
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(resolvePortalUrl(path), {
    ...options,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });
  if (res.status === 401) {
    setPortalToken(null);
    setPortalMe(null);
    throw new Error('Sessão do portal expirada. Faça login novamente.');
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(' · ');
    } catch {
      // resposta sem JSON
    }
    throw new Error(message || `Erro HTTP ${res.status}`);
  }
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  if (!text?.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Resposta inválida da API (HTTP ${res.status})`);
  }
}
