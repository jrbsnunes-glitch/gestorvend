/** Bridge opcional com o app Electron (preload expõe `window.gestorvend`). */

export type DesktopPrinter = {
  name: string;
  displayName: string;
  isDefault: boolean;
  status?: number;
  source?: string;
};

export type DesktopStationConfig = {
  token: string;
  name?: string;
  pollMs?: number;
  printers: Record<string, string>;
};

export type DesktopAgentStatus = {
  running: boolean;
  lastPollAt: number | null;
  lastError: string | null;
  lastJobId: string | null;
  stationName: string | null;
};

export type DesktopPrintSilentOpts = {
  deviceName?: string;
  pageSize?: '80mm' | 'A4';
  printBackground?: boolean;
};

export type DesktopUpdateCheckResult = {
  ok: boolean;
  updateAvailable: boolean;
  localVersion: string;
  remoteVersion?: string;
  downloadUrl?: string;
  notes?: string;
  message: string;
};

export type GestorVendDesktopApi = {
  isDesktop?: boolean;
  openStationUi?: () => Promise<{ ok: boolean; error?: string }>;
  listPrinters?: () => Promise<{
    ok: boolean;
    error?: string;
    detail?: string;
    printers: DesktopPrinter[];
  }>;
  getStation?: () => Promise<{
    config: {
      serverUrl: string;
      tenantSlug: string;
      station?: DesktopStationConfig;
      pdv?: { printer?: string };
    } | null;
    agent: DesktopAgentStatus;
  }>;
  saveStation?: (body: DesktopStationConfig) => Promise<{
    ok: boolean;
    error?: string;
    agent?: DesktopAgentStatus;
  }>;
  clearStation?: () => Promise<{ ok: boolean }>;
  testStationPrint?: (deviceName?: string) => Promise<{ ok: boolean; error?: string }>;
  stationStatus?: () => Promise<DesktopAgentStatus>;
  printSilent?: (opts?: DesktopPrintSilentOpts) => Promise<{ ok: boolean; error?: string }>;
  printUrl?: (opts: {
    url: string;
    deviceName?: string;
    pageSize?: '80mm' | 'A4';
  }) => Promise<{ ok: boolean; error?: string }>;
  getPdvPrinter?: () => Promise<{ printer: string | null }>;
  savePdvPrinter?: (body: {
    printer?: string | null;
  }) => Promise<{ ok: boolean; error?: string; printer?: string | null }>;
  getShellVersion?: () => Promise<{ version: string }>;
  checkForUpdates?: () => Promise<DesktopUpdateCheckResult>;
  openExternal?: (url: string) => Promise<void> | void;
};

declare global {
  interface Window {
    gestorvend?: GestorVendDesktopApi;
  }
}

export function getDesktopApi(): GestorVendDesktopApi | null {
  if (typeof window === 'undefined') return null;
  return window.gestorvend ?? null;
}

export function isGestorVendDesktop(): boolean {
  const api = getDesktopApi();
  return Boolean(
    api?.isDesktop ||
      api?.openStationUi ||
      api?.listPrinters ||
      api?.saveStation ||
      api?.getStation ||
      api?.printSilent ||
      api?.getPdvPrinter,
  );
}
