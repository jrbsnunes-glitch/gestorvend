import {
  readLicenseCache,
  writeLicenseCache,
  type DesktopConfig,
  type LicenseCache,
} from './config';

/** Carência offline após última validação ok (72 h). */
export const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;

/** Intervalo de revalidação em background (12 h). */
export const REVALIDATE_MS = 12 * 60 * 60 * 1000;

export type LicenseCheckResult = {
  ok: boolean;
  offline: boolean;
  message: string;
  cache: LicenseCache | null;
};

type ApiStatus = {
  ok: boolean;
  status: string;
  planCode?: string | null;
  expiresAt?: string | null;
  remainingDays?: number | null;
  message?: string;
};

export async function fetchLicenseStatus(cfg: DesktopConfig): Promise<ApiStatus> {
  const base = cfg.serverUrl.replace(/\/$/, '');
  const url = `${base}/api/license/status?tenant=${encodeURIComponent(cfg.tenantSlug)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  });
  const text = await res.text();
  const trimmed = text.trim();
  const looksHtml =
    trimmed.startsWith('<!') ||
    trimmed.toLowerCase().startsWith('<html') ||
    /<title>\s*404/i.test(trimmed);

  let data: ApiStatus;
  try {
    data = JSON.parse(text) as ApiStatus;
  } catch {
    if (res.status === 404 || looksHtml) {
      throw new Error(
        'Endpoint de licença não encontrado neste endereço. ' +
          'Use a URL do sistema GestorVend instalado (onde você faz login), ' +
          'não o site institucional. Ex.: http://127.0.0.1:5173 ou https://loja.seudominio.com',
      );
    }
    throw new Error(`Resposta inválida do servidor (HTTP ${res.status}).`);
  }
  if (!res.ok && data?.message) {
    return data;
  }
  if (!res.ok) {
    throw new Error(`Falha ao consultar licença (HTTP ${res.status}).`);
  }
  return data;
}

export async function checkLicense(cfg: DesktopConfig): Promise<LicenseCheckResult> {
  try {
    const data = await fetchLicenseStatus(cfg);
    const cache: LicenseCache = {
      ok: Boolean(data.ok),
      status: data.status || (data.ok ? 'active' : 'invalid'),
      checkedAt: Date.now(),
      message: data.message,
      expiresAt: data.expiresAt ?? null,
      remainingDays: data.remainingDays ?? null,
      planCode: data.planCode ?? null,
    };
    writeLicenseCache(cache);
    return {
      ok: cache.ok,
      offline: false,
      message: cache.ok
        ? 'Licença válida.'
        : cache.message || 'Licença inválida ou expirada.',
      cache,
    };
  } catch (err) {
    const cached = readLicenseCache();
    const now = Date.now();
    if (cached?.ok && cached.checkedAt && now - cached.checkedAt <= OFFLINE_GRACE_MS) {
      return {
        ok: true,
        offline: true,
        message: 'Servidor inacessível — usando última validação (carência offline).',
        cache: cached,
      };
    }
    const reason = err instanceof Error ? err.message : 'Erro de rede';
    return {
      ok: false,
      offline: true,
      message: cached
        ? `Servidor inacessível e carência offline esgotada. ${reason}`
        : `Não foi possível validar a licença. ${reason}`,
      cache: cached,
    };
  }
}
