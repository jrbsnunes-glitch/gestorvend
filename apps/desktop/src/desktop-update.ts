/** Comparação simples MAJOR.MINOR.PATCH (números). */
export function parseSemver(v: string): [number, number, number] | null {
  const m = String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** true se `a` > `b`. */
export function isSemverGreater(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return true;
    if (pa[i]! < pb[i]!) return false;
  }
  return false;
}

export type DesktopReleaseInfo = {
  version: string;
  downloadUrl: string;
  notes: string;
};

export async function fetchDesktopRelease(serverUrl: string): Promise<DesktopReleaseInfo> {
  const base = serverUrl.replace(/\/$/, '');
  const url = `${base}/api/public/desktop-release`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  });
  const text = await res.text();
  let data: Partial<DesktopReleaseInfo>;
  try {
    data = JSON.parse(text) as Partial<DesktopReleaseInfo>;
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(
      typeof (data as { message?: string }).message === 'string'
        ? (data as { message: string }).message
        : `Falha ao consultar versão (HTTP ${res.status}).`,
    );
  }
  return {
    version: typeof data.version === 'string' ? data.version.trim() : '',
    downloadUrl: typeof data.downloadUrl === 'string' ? data.downloadUrl.trim() : '',
    notes: typeof data.notes === 'string' ? data.notes.trim() : '',
  };
}
