import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export type DesktopConfig = {
  serverUrl: string;
  tenantSlug: string;
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
  fs.writeFileSync(
    configPath(),
    JSON.stringify(
      {
        serverUrl: cfg.serverUrl.trim().replace(/\/$/, ''),
        tenantSlug: cfg.tenantSlug.trim().toLowerCase(),
      },
      null,
      2,
    ),
    'utf8',
  );
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
