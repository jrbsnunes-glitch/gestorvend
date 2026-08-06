import { Controller, Get, Header } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export type DesktopReleaseInfo = {
  version: string;
  downloadUrl: string;
  notes: string;
};

const DEFAULT: DesktopReleaseInfo = {
  version: '1.0.0',
  downloadUrl: '',
  notes: '',
};

function resolveReleasePath(): string | null {
  const candidates = [
    path.join(__dirname, 'desktop-release.json'),
    path.join(process.cwd(), 'src', 'public', 'desktop-release.json'),
    path.join(process.cwd(), 'apps', 'api', 'src', 'public', 'desktop-release.json'),
    path.join(process.cwd(), 'public', 'desktop-release.json'),
    path.join(process.cwd(), 'apps', 'api', 'public', 'desktop-release.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function readRelease(): DesktopReleaseInfo {
  const file = resolveReleasePath();
  let data: DesktopReleaseInfo = { ...DEFAULT };
  if (file) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DesktopReleaseInfo>;
      data = {
        version: typeof raw.version === 'string' && raw.version.trim() ? raw.version.trim() : DEFAULT.version,
        downloadUrl:
          typeof raw.downloadUrl === 'string' ? raw.downloadUrl.trim() : '',
        notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
      };
    } catch {
      /* keep default */
    }
  }
  const envUrl = process.env.DESKTOP_DOWNLOAD_URL?.trim();
  if (envUrl) data.downloadUrl = envUrl;
  return data;
}

@Controller('public')
export class PublicReleaseController {
  @Get('desktop-release')
  @Header('Cache-Control', 'public, max-age=60, must-revalidate')
  desktopRelease(): DesktopReleaseInfo {
    return readRelease();
  }
}
