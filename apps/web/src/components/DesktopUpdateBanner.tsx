import { useEffect, useState } from 'react';
import { getDesktopApi, isGestorVendDesktop } from '../lib/desktop-bridge';
import { checkDesktopUpdate } from '../lib/desktop-update';

const DISMISS_KEY = 'gv_desktop_update_dismiss_day';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function isDismissedToday(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === todayKey();
  } catch {
    return false;
  }
}

function dismissForToday(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, todayKey());
  } catch {
    /* ignore */
  }
}

/**
 * Aviso quando o shell Electron está atrás da versão publicada no servidor.
 * Só aparece dentro do GestorVend Desktop.
 */
export function DesktopUpdateBanner() {
  const [msg, setMsg] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!isGestorVendDesktop() || isDismissedToday()) return;
    let cancelled = false;
    void (async () => {
      const result = await checkDesktopUpdate();
      if (cancelled || !result.ok || !result.updateAvailable) return;
      setMsg(result.message);
      setDownloadUrl(result.downloadUrl ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (hidden || !msg) return null;

  return (
    <div
      className="connection-banner connection-banner--update"
      role="status"
      style={{
        background: '#eff6ff',
        borderBottom: '1px solid #93c5fd',
        color: '#1e3a8a',
      }}
    >
      <span className="connection-banner__text">
        {msg}{' '}
        <span style={{ opacity: 0.85 }}>
          (web: Exibir → Recarregar; shell: só com novo instalador)
        </span>
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm connection-banner__retry"
        onClick={() => window.location.reload()}
      >
        Recarregar
      </button>
      {downloadUrl ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm connection-banner__retry"
          onClick={() => {
            const api = getDesktopApi();
            if (api?.openExternal) void api.openExternal(downloadUrl);
            else window.open(downloadUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          Baixar instalador
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          dismissForToday();
          setHidden(true);
        }}
      >
        Dispensar
      </button>
    </div>
  );
}
