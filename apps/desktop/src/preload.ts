import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gestorvend', {
  getConfig: () =>
    ipcRenderer.invoke('config:get') as Promise<{
      serverUrl: string;
      tenantSlug: string;
      station?: {
        token: string;
        name?: string;
        pollMs?: number;
        printers: Record<string, string>;
      };
    } | null>,
  saveConfig: (cfg: { serverUrl: string; tenantSlug: string }) =>
    ipcRenderer.invoke('config:save', cfg) as Promise<{ ok: boolean; error?: string }>,
  printSilent: () => ipcRenderer.invoke('print:silent') as Promise<{ ok: boolean; error?: string }>,
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  retryLicense: () => ipcRenderer.invoke('license:retry') as Promise<{ ok: boolean; message: string }>,
    listPrinters: () =>
    ipcRenderer.invoke('printers:list') as Promise<{
      ok: boolean;
      error?: string;
      detail?: string;
      printers: Array<{
        name: string;
        displayName: string;
        isDefault: boolean;
        status: number;
        source?: string;
      }>;
    }>,
  getStation: () =>
    ipcRenderer.invoke('station:get') as Promise<{
      config: {
        serverUrl: string;
        tenantSlug: string;
        station?: {
          token: string;
          name?: string;
          pollMs?: number;
          printers: Record<string, string>;
        };
      } | null;
      agent: {
        running: boolean;
        lastPollAt: number | null;
        lastError: string | null;
        lastJobId: string | null;
        stationName: string | null;
      };
    }>,
  saveStation: (body: {
    token: string;
    name?: string;
    pollMs?: number;
    printers: Record<string, string>;
  }) =>
    ipcRenderer.invoke('station:save', body) as Promise<{
      ok: boolean;
      error?: string;
      agent?: unknown;
    }>,
  clearStation: () => ipcRenderer.invoke('station:clear') as Promise<{ ok: boolean }>,
  testStationPrint: (deviceName?: string) =>
    ipcRenderer.invoke('station:test', deviceName) as Promise<{ ok: boolean; error?: string }>,
  openAppFromStation: () => ipcRenderer.invoke('station:openApp') as Promise<{ ok: boolean }>,
  stationStatus: () =>
    ipcRenderer.invoke('station:status') as Promise<{
      running: boolean;
      lastPollAt: number | null;
      lastError: string | null;
      lastJobId: string | null;
      stationName: string | null;
    }>,
  platform: process.platform,
});
