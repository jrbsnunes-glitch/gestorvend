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
      pdv?: { printer?: string };
    } | null>,
  saveConfig: (cfg: { serverUrl: string; tenantSlug: string }) =>
    ipcRenderer.invoke('config:save', cfg) as Promise<{ ok: boolean; error?: string }>,
  printSilent: (opts?: {
    deviceName?: string;
    pageSize?: '80mm' | 'A4';
    printBackground?: boolean;
  }) => ipcRenderer.invoke('print:silent', opts) as Promise<{ ok: boolean; error?: string }>,
  printUrl: (opts: { url: string; deviceName?: string; pageSize?: '80mm' | 'A4' }) =>
    ipcRenderer.invoke('print:url', opts) as Promise<{ ok: boolean; error?: string }>,
  getShellVersion: () =>
    ipcRenderer.invoke('shell:getVersion') as Promise<{ version: string }>,
  checkForUpdates: () =>
    ipcRenderer.invoke('desktop:checkUpdates') as Promise<{
      ok: boolean;
      updateAvailable: boolean;
      localVersion: string;
      remoteVersion?: string;
      downloadUrl?: string;
      notes?: string;
      message: string;
    }>,
  getPdvPrinter: () =>
    ipcRenderer.invoke('pdv:get') as Promise<{ printer: string | null; receiptScale?: number }>,
  savePdvPrinter: (body: { printer?: string | null; receiptScale?: number | null }) =>
    ipcRenderer.invoke('pdv:save', body) as Promise<{
      ok: boolean;
      error?: string;
      printer?: string | null;
      receiptScale?: number;
    }>,
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  retryLicense: () =>
    ipcRenderer.invoke('license:retry') as Promise<{ ok: boolean; message: string }>,
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
        pdv?: { printer?: string };
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
  openStationUi: () =>
    ipcRenderer.invoke('station:openUi') as Promise<{ ok: boolean; error?: string }>,
  stationStatus: () =>
    ipcRenderer.invoke('station:status') as Promise<{
      running: boolean;
      lastPollAt: number | null;
      lastError: string | null;
      lastJobId: string | null;
      stationName: string | null;
    }>,
  platform: process.platform,
  isDesktop: true,
});
