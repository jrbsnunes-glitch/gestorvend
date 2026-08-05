import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export type StationPrinters = Record<string, string>;

export type StationConfig = {
  token: string;
  name?: string;
  pollMs?: number;
  /** setor (ex. COZINHA) → deviceName do Windows */
  printers: StationPrinters;
};

export type DesktopConfig = {
  serverUrl: string;
  tenantSlug: string;
  station?: StationConfig;
};

export type LicenseCache = {
  ok: boolean;
  status: string;
  checkedAt: number;
  message?: string;
  expiresAt?: string | null;
  remainingDays?: number | null;
  planCode?: string | null;
};

const CONFIG_FILE = 'config.json';
const LICENSE_FILE = 'license-cache.json';

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function licensePath(): string {
  return path.join(app.getPath('userData'), LICENSE_FILE);
}

function normalizeStation(raw: unknown): StationConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  if (typeof s.token !== 'string' || !s.token.trim()) return undefined;
  const printers: StationPrinters = {};
  if (s.printers && typeof s.printers === 'object') {
    for (const [k, v] of Object.entries(s.printers as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        printers[k.trim().toUpperCase()] = v.trim();
      }
    }
  }
  return {
    token: s.token.trim(),
    name: typeof s.name === 'string' ? s.name : undefined,
    pollMs:
      typeof s.pollMs === 'number' && Number.isFinite(s.pollMs)
        ? Math.max(1500, Math.min(s.pollMs, 60_000))
        : undefined,
    printers,
  };
}

export function readConfig(): DesktopConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as DesktopConfig;
    if (
      typeof parsed.serverUrl === 'string' &&
      parsed.serverUrl.trim() &&
      typeof parsed.tenantSlug === 'string' &&
      parsed.tenantSlug.trim()
    ) {
      return {
        serverUrl: parsed.serverUrl.trim().replace(/\/$/, ''),
        tenantSlug: parsed.tenantSlug.trim().toLowerCase(),
        station: normalizeStation(parsed.station),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeConfig(cfg: DesktopConfig): void {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  const payload: DesktopConfig = {
    serverUrl: cfg.serverUrl.trim().replace(/\/$/, ''),
    tenantSlug: cfg.tenantSlug.trim().toLowerCase(),
  };
  if (cfg.station?.token) {
    payload.station = {
      token: cfg.station.token.trim(),
      name: cfg.station.name,
      pollMs: cfg.station.pollMs,
      printers: cfg.station.printers ?? {},
    };
  }
  fs.writeFileSync(configPath(), JSON.stringify(payload, null, 2), 'utf8');
}

/** Atualiza só a parte da estação, preservando serverUrl/tenant. */
export function writeStationConfig(station: StationConfig | null): DesktopConfig | null {
  const cfg = readConfig();
  if (!cfg) return null;
  if (station?.token) {
    cfg.station = {
      token: station.token.trim(),
      name: station.name,
      pollMs: station.pollMs,
      printers: station.printers ?? {},
    };
  } else {
    delete cfg.station;
  }
  writeConfig(cfg);
  return cfg;
}

export function readLicenseCache(): LicenseCache | null {
  try {
    const raw = fs.readFileSync(licensePath(), 'utf8');
    return JSON.parse(raw) as LicenseCache;
  } catch {
    return null;
  }
}

export function writeLicenseCache(cache: LicenseCache): void {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(licensePath(), JSON.stringify(cache, null, 2), 'utf8');
}
