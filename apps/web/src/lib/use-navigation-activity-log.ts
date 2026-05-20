import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api';
import { resolveNavMenuMeta } from './nav-menu-registry';

/** Evita gravações duplicadas ao re-renderizar no mesmo path. */
const DEDUPE_MS = 20_000;

/**
 * Envia um registro de acesso à API ao mudar a rota no layout principal.
 * Falhas são ignoradas (não bloqueiam a navegação).
 */
export function useNavigationActivityLogger() {
  const location = useLocation();
  const lastRef = useRef<{ path: string; t: number } | null>(null);

  useEffect(() => {
    const meta = resolveNavMenuMeta(location.pathname);
    const now = Date.now();
    const last = lastRef.current;
    if (last && last.path === meta.path && now - last.t < DEDUPE_MS) return;
    lastRef.current = { path: meta.path, t: now };
    void api('/activity-logs', {
      method: 'POST',
      json: {
        path: meta.path,
        menuKey: meta.menuKey,
        menuLabel: meta.menuLabel,
      },
    }).catch(() => {});
  }, [location.pathname]);
}
