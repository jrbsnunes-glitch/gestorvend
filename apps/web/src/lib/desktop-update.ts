import { resolveApiUrl } from './api';
import { getDesktopApi, isGestorVendDesktop } from './desktop-bridge';
import { isSemverGreater } from './semver';

export type DesktopReleaseInfo = {
  version: string;
  downloadUrl: string;
  notes: string;
};

export type DesktopUpdateCheck = {
  ok: boolean;
  updateAvailable: boolean;
  localVersion: string;
  remoteVersion?: string;
  downloadUrl?: string;
  notes?: string;
  message: string;
};

export async function fetchDesktopRelease(): Promise<DesktopReleaseInfo> {
  const res = await fetch(resolveApiUrl('/public/desktop-release'), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const text = await res.text();
  let data: Partial<DesktopReleaseInfo>;
  try {
    data = JSON.parse(text) as Partial<DesktopReleaseInfo>;
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(`Falha ao consultar versão (HTTP ${res.status}).`);
  }
  return {
    version: typeof data.version === 'string' ? data.version.trim() : '',
    downloadUrl: typeof data.downloadUrl === 'string' ? data.downloadUrl.trim() : '',
    notes: typeof data.notes === 'string' ? data.notes.trim() : '',
  };
}

/** Preferência: IPC nativo do Desktop; fallback: versão local + API. */
export async function checkDesktopUpdate(): Promise<DesktopUpdateCheck> {
  const apiDesktop = getDesktopApi();
  if (apiDesktop?.checkForUpdates) {
    return apiDesktop.checkForUpdates();
  }

  let localVersion = '0.0.0';
  try {
    const shell = await apiDesktop?.getShellVersion?.();
    if (shell?.version) localVersion = shell.version;
  } catch {
    /* ignore */
  }

  if (!isGestorVendDesktop()) {
    return {
      ok: false,
      updateAvailable: false,
      localVersion,
      message: 'Abra pelo GestorVend Desktop para verificar o shell.',
    };
  }

  try {
    const remote = await fetchDesktopRelease();
    const updateAvailable = isSemverGreater(remote.version, localVersion);
    return {
      ok: true,
      updateAvailable,
      localVersion,
      remoteVersion: remote.version,
      downloadUrl: remote.downloadUrl || undefined,
      notes: remote.notes || undefined,
      message: updateAvailable
        ? `Há uma nova versão do Desktop: v${remote.version} (você tem v${localVersion}).`
        : `Desktop atualizado (v${localVersion}).`,
    };
  } catch (err) {
    return {
      ok: false,
      updateAvailable: false,
      localVersion,
      message: err instanceof Error ? err.message : 'Falha ao verificar atualizações.',
    };
  }
}
