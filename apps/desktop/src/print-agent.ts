import { BrowserWindow, type WebContentsPrintOptions } from 'electron';
import * as path from 'path';
import { readConfig, type DesktopConfig, type StationConfig } from './config';

type AgentJob = {
  id: string;
  kind: string;
  sector: string;
  payload: unknown;
  copies: number;
};

type PollResponse = {
  station: { id: string; name: string; sectors: string[] };
  jobs: AgentJob[];
};

export type PrintAgentStatus = {
  running: boolean;
  lastPollAt: number | null;
  lastError: string | null;
  lastJobId: string | null;
  stationName: string | null;
};

let timer: NodeJS.Timeout | null = null;
let busy = false;
let status: PrintAgentStatus = {
  running: false,
  lastPollAt: null,
  lastError: null,
  lastJobId: null,
  stationName: null,
};

function rendererPath(file: string): string {
  return path.join(__dirname, '..', 'renderer', file);
}

function apiBase(cfg: DesktopConfig): string {
  return `${cfg.serverUrl.replace(/\/$/, '')}/api`;
}

async function pollOnce(cfg: DesktopConfig, station: StationConfig): Promise<void> {
  const url = `${apiBase(cfg)}/printing/agent/poll?tenant=${encodeURIComponent(cfg.tenantSlug)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${station.token}`,
    },
    body: JSON.stringify({ limit: 5 }),
  });
  const text = await res.text();
  let data: PollResponse;
  try {
    data = JSON.parse(text) as PollResponse;
  } catch {
    throw new Error(`Resposta inválida do poll (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(
      typeof (data as unknown as { message?: string }).message === 'string'
        ? (data as unknown as { message: string }).message
        : `Poll falhou (HTTP ${res.status}).`,
    );
  }
  status.stationName = data.station?.name ?? status.stationName;
  status.lastPollAt = Date.now();
  status.lastError = null;

  for (const job of data.jobs ?? []) {
    status.lastJobId = job.id;
    try {
      await printJob(cfg, station, job);
      await ack(cfg, station, job.id, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status.lastError = msg;
      try {
        await ack(cfg, station, job.id, false, msg);
      } catch {
        /* ignore ack failure */
      }
    }
  }
}

async function ack(
  cfg: DesktopConfig,
  station: StationConfig,
  jobId: string,
  ok: boolean,
  error?: string,
): Promise<void> {
  const url = `${apiBase(cfg)}/printing/agent/jobs/${encodeURIComponent(jobId)}/ack?tenant=${encodeURIComponent(cfg.tenantSlug)}`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${station.token}`,
    },
    body: JSON.stringify({ ok, error }),
  });
}

function deviceForSector(station: StationConfig, sector: string): string | undefined {
  const key = (sector || 'COZINHA').trim().toUpperCase();
  return station.printers[key] || station.printers['COZINHA'] || Object.values(station.printers)[0];
}

async function printJob(cfg: DesktopConfig, station: StationConfig, job: AgentJob): Promise<void> {
  const deviceName = deviceForSector(station, job.sector);
  const copies = Math.max(1, Math.min(job.copies || 1, 5));

  const win = new BrowserWindow({
    width: 400,
    height: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await win.loadFile(rendererPath('ticket.html'));
    await win.webContents.executeJavaScript(
      `window.__GV_RENDER_TICKET__(${JSON.stringify(job.payload)}); true;`,
    );
    // pequena folga para layout
    await new Promise((r) => setTimeout(r, 200));

    for (let i = 0; i < copies; i++) {
      const opts: WebContentsPrintOptions = {
        silent: true,
        printBackground: true,
        // 80 mm de largura em microns; altura generosa para bobina
        pageSize: { width: 80_000, height: 200_000 },
      };
      if (deviceName) {
        (opts as WebContentsPrintOptions & { deviceName?: string }).deviceName = deviceName;
      }
      await new Promise<void>((resolve, reject) => {
        win.webContents.print(opts, (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(failureReason || 'Falha na impressão silenciosa'));
        });
      });
    }
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function tick(): Promise<void> {
  if (busy) return;
  const cfg = readConfig();
  if (!cfg?.station?.token) {
    stopPrintAgent();
    return;
  }
  busy = true;
  try {
    await pollOnce(cfg, cfg.station);
  } catch (e) {
    status.lastError = e instanceof Error ? e.message : String(e);
    status.lastPollAt = Date.now();
  } finally {
    busy = false;
  }
}

export function getPrintAgentStatus(): PrintAgentStatus {
  return { ...status };
}

export function startPrintAgent(): void {
  const cfg = readConfig();
  if (!cfg?.station?.token) {
    status.running = false;
    return;
  }
  if (timer) return;
  status.running = true;
  const ms = cfg.station.pollMs ?? 3000;
  void tick();
  timer = setInterval(() => {
    void tick();
  }, ms);
}

export function stopPrintAgent(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  status.running = false;
}

export function restartPrintAgent(): void {
  stopPrintAgent();
  startPrintAgent();
}

/** Impressão de teste local (sem fila), com o payload mínimo. */
export async function printTestTicket(deviceName?: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = readConfig();
  if (!cfg?.station) return { ok: false, error: 'Estação não configurada.' };
  const payload = {
    kind: 'KITCHEN',
    title: 'TESTE',
    tabNumber: 0,
    guestCount: 1,
    additional: false,
    printedAt: new Date().toISOString(),
    items: [{ id: 't', name: 'Impressão de teste local', quantity: 1, notes: cfg.station.name ?? null }],
  };
  const fakeJob: AgentJob = {
    id: 'local-test',
    kind: 'KITCHEN',
    sector: 'COZINHA',
    payload,
    copies: 1,
  };
  const station: StationConfig = {
    ...cfg.station,
    printers: deviceName
      ? { ...cfg.station.printers, COZINHA: deviceName }
      : cfg.station.printers,
  };
  try {
    await printJob(cfg, station, fakeJob);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
