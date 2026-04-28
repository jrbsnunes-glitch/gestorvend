const TOKEN_KEY = 'gv_access_token';

/** Disparado após limpar o token em resposta 401 — use para voltar à tela de login. */
export const GV_UNAUTHORIZED_EVENT = 'gv:unauthorized';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function resolveApiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const base = typeof raw === 'string' ? raw.trim() : '';
  if (base) {
    return `${base.replace(/\/$/, '')}/api${path}`;
  }
  return `/api${path}`;
}

function formatApiErrorBody(status: number, statusText: string, raw: string): string {
  const trimmed = raw.trim();
  if (trimmed) {
    try {
      const j = JSON.parse(trimmed) as {
        message?: string | string[];
        error?: string;
      };
      if (Array.isArray(j.message)) return j.message.join('; ');
      if (typeof j.message === 'string' && j.message.trim()) {
        if (status === 401 && j.message === 'Unauthorized') {
          return 'Sessão expirada ou inválida. Faça login novamente.';
        }
        return j.message;
      }
      if (typeof j.error === 'string' && j.error.trim()) {
        return j.error;
      }
    } catch {
      return trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
    }
  }
  if (status === 401) return 'Sessão expirada ou inválida. Faça login novamente.';
  const st = statusText?.trim();
  if (st) {
    return `Falha ao chamar o servidor (HTTP ${status}: ${st}). Se estiver no modo desenvolvimento, confira se a API está rodando na porta configurada no proxy do Vite (geralmente 3000).`;
  }
  return `Falha ao chamar o servidor (HTTP ${status}). Verifique se a API está em execução e se as migrações do banco do tenant foram aplicadas.`;
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers: HeadersInit = {
    ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  };
  const token = getToken();
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(path), {
      ...options,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
  } catch (e) {
    throw new Error(
      e instanceof TypeError
        ? 'Não foi possível contatar o servidor. Confira se a API NestJS está rodando (ex.: npm run start:dev em apps/api) e se o front usa o proxy /api → localhost da API.'
        : e instanceof Error
          ? e.message
          : 'Falha de rede',
    );
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      setToken(null);
      window.dispatchEvent(new CustomEvent(GV_UNAUTHORIZED_EVENT));
      throw new Error(formatApiErrorBody(401, res.statusText, text));
    }
    throw new Error(formatApiErrorBody(res.status, res.statusText, text));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
