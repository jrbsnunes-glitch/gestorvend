import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp = require('sharp');

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 2 * 1024 * 1024;

export type ProductImageSize = 'thumb' | 'medium';

@Injectable()
export class ProductImageStorage {
  constructor(private readonly config: ConfigService) {}

  getUploadRoot(): string {
    const configured = this.config.get<string>('UPLOAD_DIR')?.trim();
    if (configured) return path.resolve(configured);
    return path.resolve(process.cwd(), 'data', 'uploads');
  }

  productDir(tenantSlug: string): string {
    return path.join(this.getUploadRoot(), 'tenants', tenantSlug, 'products');
  }

  filePath(tenantSlug: string, productId: string, size: ProductImageSize): string {
    return path.join(this.productDir(tenantSlug), `${productId}-${size}.webp`);
  }

  publicUrl(
    tenantSlug: string,
    productId: string,
    size: ProductImageSize,
    version: number,
  ): string {
    return `/api/catalog/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(productId)}/image?size=${size}&v=${version}`;
  }

  assertAllowedMime(mime: string | undefined): string {
    const m = (mime ?? '').toLowerCase().split(';')[0].trim();
    if (!ALLOWED_MIME.has(m)) {
      throw new BadRequestException('Formato não suportado. Envie PNG, JPEG ou WebP (até 2 MB).');
    }
    return m;
  }

  assertMaxSize(size: number): void {
    if (size > MAX_BYTES) {
      throw new BadRequestException('Imagem muito grande. Máximo 2 MB.');
    }
  }

  async saveFromBuffer(tenantSlug: string, productId: string, buffer: Buffer): Promise<void> {
    const dir = this.productDir(tenantSlug);
    await fs.mkdir(dir, { recursive: true });

    const thumbPath = this.filePath(tenantSlug, productId, 'thumb');
    const mediumPath = this.filePath(tenantSlug, productId, 'medium');

    const image = sharp(buffer, { failOn: 'none' }).rotate();

    await image
      .clone()
      .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(thumbPath);

    await image
      .clone()
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(mediumPath);
  }

  async remove(tenantSlug: string, productId: string): Promise<void> {
    for (const size of ['thumb', 'medium'] as const) {
      const fp = this.filePath(tenantSlug, productId, size);
      try {
        await fs.unlink(fp);
      } catch {
        /* ignore */
      }
    }
  }

  async resolveFile(
    tenantSlug: string,
    productId: string,
    size: ProductImageSize,
  ): Promise<string> {
    const fp = this.filePath(tenantSlug, productId, size);
    try {
      await fs.access(fp);
      return fp;
    } catch {
      throw new NotFoundException('Imagem não encontrada.');
    }
  }
}
