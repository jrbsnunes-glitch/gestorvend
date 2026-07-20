import { useCallback, useEffect, useState } from 'react';
import { pingHealth } from '../lib/api';

export type ConnectionStatus = 'online' | 'offline' | 'api-unreachable';

const DEFAULT_INTERVAL_MS = 45_000;

export function useConnectionStatus(intervalMs = DEFAULT_INTERVAL_MS) {
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [apiOk, setApiOk] = useState(true);
  const [checking, setChecking] = useState(false);

  const checkApi = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setApiOk(false);
      return false;
    }
    setChecking(true);
    try {
      const ok = await pingHealth();
      setApiOk(ok);
      return ok;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    function onOnline(): void {
      setBrowserOnline(true);
      void checkApi();
    }
    function onOffline(): void {
      setBrowserOnline(false);
      setApiOk(false);
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [checkApi]);

  useEffect(() => {
    void checkApi();
    const id = window.setInterval(() => void checkApi(), intervalMs);
    return () => clearInterval(id);
  }, [checkApi, intervalMs]);

  useEffect(() => {
    function onVisible(): void {
      if (document.visibilityState === 'visible') void checkApi();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [checkApi]);

  const status: ConnectionStatus = !browserOnline
    ? 'offline'
    : apiOk
      ? 'online'
      : 'api-unreachable';

  return { status, browserOnline, apiOk, checking, recheck: checkApi };
}
