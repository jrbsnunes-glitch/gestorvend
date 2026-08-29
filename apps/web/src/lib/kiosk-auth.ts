import { formatFetchNetworkError, resolveApiUrl } from './api';

const KIOSK_TOKEN_KEY = 'gv_kiosk_access';
const KIOSK_REFRESH_KEY = 'gv_kiosk_refresh';
const KIOSK_META_KEY = 'gv_kiosk_meta';

export type KioskMeta = {
  tenantSlug: string;
  terminalNumber: number;
  terminalId: string;
  terminalName: string;
};

export function getKioskToken(): string | null {
  return localStorage.getItem(KIOSK_TOKEN_KEY);
}

export function getKioskRefreshToken(): string | null {
  return localStorage.getItem(KIOSK_REFRESH_KEY);
}

export function getKioskMeta(): KioskMeta | null {
  try {
    const raw = localStorage.getItem(KIOSK_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as KioskMeta;
  } catch {
    return null;
  }
}

export function setKioskAuth(body: {
  accessToken: string;
  refreshToken: string;
  meta: KioskMeta;
}): void {
  localStorage.setItem(KIOSK_TOKEN_KEY, body.accessToken);
  localStorage.setItem(KIOSK_REFRESH_KEY, body.refreshToken);
  localStorage.setItem(KIOSK_META_KEY, JSON.stringify(body.meta));
}

export function clearKioskAuth(): void {
  localStorage.removeItem(KIOSK_TOKEN_KEY);
  localStorage.removeItem(KIOSK_REFRESH_KEY);
  localStorage.removeItem(KIOSK_META_KEY);
}

function formatApiError(status: number, statusText: string, raw: string): string {
  const trimmed = raw.trim();
  if (trimmed) {
    try {
      const j = JSON.parse(trimmed) as { message?: string | string[] };
      if (Array.isArray(j.message)) return j.message.join('; ');
      if (typeof j.message === 'string' && j.message.trim()) return j.message.trim();
    } catch {
      if (trimmed.length < 400) return trimmed;
    }
  }
  return `Erro HTTP ${status}${statusText ? ` (${statusText})` : ''}`;
}

export async function apiKiosk<T>(
  path: string,
  opts?: { method?: string; json?: unknown },
): Promise<T> {
  const token = getKioskToken();
  if (!token) throw new Error('Terminal não autenticado.');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  let body: string | undefined;
  if (opts?.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }

  let res: Response;
  try {
    res = await fetch(resolveApiUrl(path), {
      method: opts?.method ?? (opts?.json !== undefined ? 'POST' : 'GET'),
      headers,
      body,
    });
  } catch (e) {
    throw new Error(formatFetchNetworkError(e));
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(formatApiError(res.status, res.statusText, text));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function loginKioskTerminal(body: {
  tenantSlug: string;
  terminalNumber: number;
  token: string;
}): Promise<KioskMeta> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl('/pdv-terminals/auth'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(formatFetchNetworkError(e));
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(formatApiError(res.status, res.statusText, text));
  }

  const data = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    terminal: { id: string; number: number; name: string };
  };

  const meta: KioskMeta = {
    tenantSlug: body.tenantSlug.trim().toLowerCase(),
    terminalNumber: data.terminal.number,
    terminalId: data.terminal.id,
    terminalName: data.terminal.name,
  };

  setKioskAuth({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    meta,
  });

  return meta;
}
