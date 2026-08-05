import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gestorvend', {
  getConfig: () => ipcRenderer.invoke('config:get') as Promise<{ serverUrl: string; tenantSlug: string } | null>,
  saveConfig: (cfg: { serverUrl: string; tenantSlug: string }) =>
    ipcRenderer.invoke('config:save', cfg) as Promise<{ ok: boolean; error?: string }>,
  printSilent: () => ipcRenderer.invoke('print:silent') as Promise<{ ok: boolean; error?: string }>,
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  retryLicense: () => ipcRenderer.invoke('license:retry') as Promise<{ ok: boolean; message: string }>,
  platform: process.platform,
});
