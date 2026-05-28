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

const LOGO_BASENAME = 'logo';

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

  /** URL pública servida pelo `BrandingController` (mesma origem /api). */
  publicLogoPath(tenantSlug: string): string {
    return `/api/branding/${encodeURIComponent(tenantSlug)}/logo`;
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

  async save(tenantSlug: string, buffer: Buffer, mime: string): Promise<string> {
    const normalizedMime = this.assertAllowedMime(mime);
    const ext = EXT_BY_MIME[normalizedMime];
    const dir = this.tenantDir(tenantSlug);
    await fs.mkdir(dir, { recursive: true });

    for (const oldExt of Object.values(EXT_BY_MIME)) {
      try {
        await fs.unlink(path.join(dir, `${LOGO_BASENAME}${oldExt}`));
      } catch {
        /* arquivo anterior inexistente */
      }
    }

    await fs.writeFile(path.join(dir, `${LOGO_BASENAME}${ext}`), buffer);
    return this.publicLogoPath(tenantSlug);
  }

  async resolveFile(tenantSlug: string): Promise<{ filePath: string; mime: string }> {
    const dir = this.tenantDir(tenantSlug);
    for (const [mime, ext] of Object.entries(EXT_BY_MIME)) {
      const candidate = path.join(dir, `${LOGO_BASENAME}${ext}`);
      try {
        await fs.access(candidate);
        return { filePath: candidate, mime };
      } catch {
        /* tenta próxima extensão */
      }
    }
    throw new NotFoundException('Logotipo não encontrado para esta loja.');
  }
}
