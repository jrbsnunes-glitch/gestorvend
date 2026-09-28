import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { isGestorVendDesktop } from '../lib/desktop-bridge';
import {
  FULL_PDV_CAPABILITIES,
  readTerminalFromUrl,
  setPdvTerminalNumber,
  type PdvTerminalCapabilities,
} from '../lib/pdv-terminal-context';

export type PdvTerminalProfile = {
  id: string;
  number: number;
  name: string;
  mode: 'SELF_SERVICE' | 'OPERATOR';
  role: 'PRIMARY' | 'SATELLITE';
  pairingUrl: string;
  capabilities: PdvTerminalCapabilities;
};

export function usePdvTerminal() {
  const [searchParams] = useSearchParams();
  const [desktopNumber, setDesktopNumber] = useState<number | null>(null);

  useEffect(() => {
    if (!isGestorVendDesktop()) return;
    const gv = window.gestorvend;
    if (!gv?.getConfig) return;
    void gv.getConfig().then((cfg) => {
      const n = cfg?.pdvTerminal?.number;
      if (n != null && n >= 1) setDesktopNumber(Math.floor(n));
    });
  }, []);

  const number = useMemo(() => {
    const fromUrl = readTerminalFromUrl(searchParams.toString());
    if (fromUrl) return fromUrl;
    if (desktopNumber) return desktopNumber;
    return null;
  }, [searchParams, desktopNumber]);

  useEffect(() => {
    setPdvTerminalNumber(number);
  }, [number]);

  const profileQ = useQuery({
    queryKey: ['pdv-terminals', 'by-number', number],
    queryFn: () => api<PdvTerminalProfile>(`/pdv-terminals/by-number/${number}`),
    enabled: number != null,
    staleTime: 60_000,
  });

  const capabilities = profileQ.data?.capabilities ?? FULL_PDV_CAPABILITIES;

  return {
    number,
    profile: profileQ.data ?? null,
    capabilities,
    isLoading: number != null && profileQ.isLoading,
    isSatellite: capabilities.isSatellite,
  };
}
