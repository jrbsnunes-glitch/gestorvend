const TOKEN_KEY = 'gv_access_token';
const REFRESH_KEY = 'gv_refresh_token';

/** Dispara quando access/refresh são limpos ou alterados (mesma aba). */
export const GV_AUTH_CHANGED_EVENT = 'gv:auth-changed';

/** Dispara após limpar o token em resposta 401 — use para voltar à tela de login. */
export const GV_UNAUTHORIZED_EVENT = 'gv:unauthorized';

/** Renovar ~90s antes do access token expirar (evita 401 em uso contínuo). */
const REFRESH_BEFORE_EXPIRY_MS = 90_000;
const PROACTIVE_MIN_DELAY_MS = 5_000;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityListenerAttached = false;

function clearProactiveRefresh(): void {
  if (proactiveTimer !== null) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
}

function getJwtExpMs(accessToken: string): number | null {
  try {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const obj = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof obj.exp !== 'number') return null;
    return obj.exp * 1000;
  } catch {
    return null;
  }
}

function ensureVisibilityListener(): void {
  if (visibilityListenerAttached || typeof document === 'undefined') return;
  visibilityListenerAttached = true;
  document.addEventListener('visibilitychange', onVisibilityForProactiveRefresh);
}

function onVisibilityForProactiveRefresh(): void {
  if (document.visibilityState !== 'visible') return;
  const access = getToken();
  if (!access || !getRefreshToken()) return;
  const expMs = getJwtExpMs(access);
  if (expMs === null) return;
  if (expMs - Date.now() < REFRESH_BEFORE_EXPIRY_MS) {
    void refreshAccessToken().then((ok) => {
      if (ok) scheduleAccessTokenRefresh();
    });
  }
}

/** Agenda renovação silenciosa do access token (chame após login ou ao restaurar sessão). */
export function scheduleAccessTokenRefresh(): void {
  clearProactiveRefresh();
  ensureVisibilityListener();

  const access = getToken();
  if (!access || !getRefreshToken()) return;

  const expMs = getJwtExpMs(access);
  if (expMs === null) return;

  const refreshAt = expMs - REFRESH_BEFORE_EXPIRY_MS;
  const delay = Math.max(refreshAt - Date.now(), PROACTIVE_MIN_DELAY_MS);

  proactiveTimer = window.setTimeout(() => {
    proactiveTimer = null;
    void (async () => {
      if (!getToken() || !getRefreshToken()) return;
      const current = getToken()!;
      const exp2 = getJwtExpMs(current);
      if (exp2 !== null && exp2 - Date.now() > REFRESH_BEFORE_EXPIRY_MS) {
        scheduleAccessTokenRefresh();
        return;
      }
      const ok = await refreshAccessToken();
      if (ok) scheduleAccessTokenRefresh();
    })();
  }, delay);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    scheduleAccessTokenRefresh();
  } else {
    localStorage.removeItem(TOKEN_KEY);
    clearProactiveRefresh();
  }
  window.dispatchEvent(new Event(GV_AUTH_CHANGED_EVENT));
}

export function setRefreshToken(token: string | null): void {
  if (token) {
    localStorage.setItem(REFRESH_KEY, token);
    if (getToken()) scheduleAccessTokenRefresh();
  } else {
    localStorage.removeItem(REFRESH_KEY);
    clearProactiveRefresh();
    window.dispatchEvent(new Event(GV_AUTH_CHANGED_EVENT));
  }
}

/** Remove access + refresh (ex.: logout). Não dispara evento de sessão expirada. */
export function clearAuthStorage(): void {
  clearProactiveRefresh();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  window.dispatchEvent(new Event(GV_AUTH_CHANGED_EVENT));
}

function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async (): Promise<boolean> => {
    try {
      const res = await fetch(resolveApiUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken?: string };
      if (!data.accessToken) return false;
      setToken(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** Mensagem amigável para falha de rede no fetch (ex.: API parada, URL errada, bloqueio do navegador). */
export function formatFetchNetworkError(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Não foi possível contatar o servidor. Confira se `npm run dev` na raiz está ativo (API + Vite), se a API escuta na porta do proxy (padrão 3000) e se não há `VITE_API_BASE_URL` apontando para host/porta incorretos.';
  }
  if (error instanceof Error) return error.message;
  return 'Falha de rede';
}

function resolveApiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const base = typeof raw === 'string' ? raw.trim() : '';
  if (base) {
    return `${base.replace(/\/$/, '')}/api${path}`;
  }
  return `/api${path}`;
}

function unauthorizedUserMessage(reason?: string): string {
  const r = reason?.trim();
  if (
    r &&
    !/^Unauthorized$/iu.test(r) &&
    !/^access denied$/iu.test(r) &&
    r.length > 5
  ) {
    return r;
  }
  return 'Sessão expirada ou inválida. Faça login novamente.';
}

/** Ajuda quando o proxy (Vite/nginx) não alcança a API — usado também na tela de login. */
export function upstreamUnavailableHint(status: number): string | undefined {
  if (status !== 502 && status !== 503) return undefined;
  const baseHint =
    status === 502
      ? 'O proxy não conseguiu falar com a API Nest (conexão recusada ou processo não respondendo).'
      : 'A API pode estar inicializando, reiniciando ou sobrecarregada.';
  return `${baseHint} Em desenvolvimento: na raiz do projeto rode \`npm run dev\` (sobe API + Vite), ou apenas \`npm run dev:api\`. Confira se a porta bate com o proxy (variável \`VITE_API_PROXY_TARGET\`, padrão http://127.0.0.1:3000) e \`PORT\` no \`.env\` da API. Se a API subir e cair ao iniciar, veja Postgres, Redis e migrações.`;
}

/** Corpo texto da resposta de login falhado → mensagem amigável em português. */
export function formatLoginFailureMessage(httpStatus: number, bodyText: string): string {
  const trimmed = bodyText.trim();
  if (trimmed) {
    try {
      const j = JSON.parse(trimmed) as { message?: string | string[]; error?: string };
      if (Array.isArray(j.message)) {
        const joined = j.message.join('; ');
        if (joined.trim()) return joined.trim();
      }
      if (typeof j.message === 'string' && j.message.trim()) {
        return j.message.trim();
      }
      if (typeof j.error === 'string' && j.error.trim()) {
        return j.error.trim();
      }
    } catch {
      /* corpo não é JSON (ex.: proxy devolve HTML) */
    }
  }
  const up = upstreamUnavailableHint(httpStatus);
  if (up) return up;
  return `Falha no login (HTTP ${httpStatus}).`;
}

function formatApiErrorBody(status: number, statusText: string, raw: string): string {
  const trimmed = raw.trim();
  const looksUnauthorizedPlain =
    status === 401 && /^Unauthorized$/iu.test(trimmed);
  if (looksUnauthorizedPlain) {
    return unauthorizedUserMessage(trimmed);
  }
  if (trimmed) {
    try {
      const j = JSON.parse(trimmed) as {
        message?: string | string[];
        error?: string;
      };
      if (Array.isArray(j.message)) {
        const joined = j.message.join('; ');
        if (status === 401) return unauthorizedUserMessage(joined);
        return joined;
      }
      if (typeof j.message === 'string' && j.message.trim()) {
        const ms = j.message.trim();
        if (status === 401 && /^Unauthorized$/iu.test(ms)) {
          return unauthorizedUserMessage(ms);
        }
        return ms;
      }
      if (typeof j.error === 'string' && j.error.trim()) {
        const er = j.error.trim();
        if (status === 401 && /^Unauthorized$/iu.test(er)) {
          return unauthorizedUserMessage(er);
        }
        return er;
      }
    } catch {
      if (status === 401 && /^Unauthorized$/iu.test(trimmed)) {
        return unauthorizedUserMessage(trimmed);
      }
      return trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
    }
  }
  if (status === 401) return unauthorizedUserMessage();
  const up = upstreamUnavailableHint(status);
  if (up) return up;
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
  const buildHeaders = (): HeadersInit => {
    const headers: HeadersInit = {
      ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    };
    const token = getToken();
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const body = options.json !== undefined ? JSON.stringify(options.json) : options.body;

  const request = () =>
    fetch(resolveApiUrl(path), {
      ...options,
      headers: buildHeaders(),
      body,
    });

  let res: Response;
  try {
    res = await request();
  } catch (e) {
    throw new Error(formatFetchNetworkError(e));
  }

  if (res.status === 401 && path !== '/auth/refresh' && getRefreshToken()) {
    const renewed = await refreshAccessToken();
    if (renewed) {
      try {
        res = await request();
      } catch (e) {
        throw new Error(formatFetchNetworkError(e));
      }
    }
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      clearAuthStorage();
      window.dispatchEvent(new CustomEvent(GV_UNAUTHORIZED_EVENT));
      throw new Error(formatApiErrorBody(401, res.statusText, text));
    }
    throw new Error(formatApiErrorBody(res.status, res.statusText, text));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
