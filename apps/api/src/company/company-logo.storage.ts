import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Aceita `logo.png` (legado) e `logo-1739….png` (versão). */
const LOGO_FILE_RE = /^logo(?:-\d+)?\.(png|jpe?g|webp)$/i;

@Injectable()
export class CompanyLogoStorage {
  constructor(private readonly config: ConfigService) {}

  getUploadRoot(): string {
    const configured = this.config.get<string>('UPLOAD_DIR')?.trim();
    if (configured) return path.resolve(configured);
    return path.resolve(process.cwd(), 'data', 'uploads');
  }

  tenantDir(tenantSlug: string): string {
    return path.join(this.getUploadRoot(), 'tenants', tenantSlug);
  }

  /**
   * URL pública com `?v=` para forçar o navegador a buscar o arquivo novo
   * (a rota ignora o query; só muda o cache).
   */
  publicLogoPath(tenantSlug: string, version: number | string): string {
    return `/api/branding/${encodeURIComponent(tenantSlug)}/logo?v=${version}`;
  }

  assertAllowedMime(mime: string | undefined): string {
    const m = (mime ?? '').toLowerCase().split(';')[0].trim();
    if (!ALLOWED_MIME.has(m)) {
      throw new BadRequestException(
        'Formato não suportado. Envie PNG, JPEG ou WebP (até 2 MB).',
      );
    }
    return m;
  }

  private async unlinkQuiet(filePath: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.unlink(filePath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') return;
        // Windows: arquivo ainda aberto por leitura anterior — espera e tenta de novo
        if (attempt < 4 && (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')) {
          await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
          continue;
        }
        return;
      }
    }
  }

  private async listLogoFiles(dir: string): Promise<string[]> {
    try {
      const names = await fs.readdir(dir);
      return names.filter((n) => LOGO_FILE_RE.test(n));
    } catch {
      return [];
    }
  }

  async save(tenantSlug: string, buffer: Buffer, mime: string): Promise<string> {
    const normalizedMime = this.assertAllowedMime(mime);
    const ext = EXT_BY_MIME[normalizedMime];
    const dir = this.tenantDir(tenantSlug);
    await fs.mkdir(dir, { recursive: true });

    const version = Date.now();
    const finalName = `logo-${version}${ext}`;
    const finalPath = path.join(dir, finalName);
    const tmpPath = path.join(dir, `logo-${version}.tmp${ext}`);

    // Grava em arquivo temporário e renomeia — evita servir arquivo pela metade
    await fs.writeFile(tmpPath, buffer);
    await fs.rename(tmpPath, finalPath);

    // Remove logos anteriores (legado `logo.png` e outras versões)
    const existing = await this.listLogoFiles(dir);
    for (const name of existing) {
      if (name === finalName) continue;
      await this.unlinkQuiet(path.join(dir, name));
    }

    return this.publicLogoPath(tenantSlug, version);
  }

  async resolveFile(tenantSlug: string): Promise<{ filePath: string; mime: string }> {
    const dir = this.tenantDir(tenantSlug);
    const names = await this.listLogoFiles(dir);
    if (!names.length) {
      throw new NotFoundException('Logotipo não encontrado para esta loja.');
    }

    // Prefere o arquivo mais recente (mtime); desempate pelo nome com timestamp
    let best: { name: string; mtime: number } | null = null;
    for (const name of names) {
      const filePath = path.join(dir, name);
      try {
        const st = await fs.stat(filePath);
        const mtime = st.mtimeMs;
        if (!best || mtime > best.mtime || (mtime === best.mtime && name > best.name)) {
          best = { name, mtime };
        }
      } catch {
        /* ignora */
      }
    }
    if (!best) {
      throw new NotFoundException('Logotipo não encontrado para esta loja.');
    }

    const ext = path.extname(best.name).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    return { filePath: path.join(dir, best.name), mime };
  }
}
