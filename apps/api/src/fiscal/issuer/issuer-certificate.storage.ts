import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

const CERT_BASENAME = 'issuer.pfx';
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Guarda o A1 (.pfx) por tenant sob UPLOAD_DIR — mesma raiz da logo,
 * pasta `certs/` sem URL pública.
 */
@Injectable()
export class IssuerCertificateStorage {
  constructor(private readonly config: ConfigService) {}

  getUploadRoot(): string {
    const configured = this.config.get<string>('UPLOAD_DIR')?.trim();
    if (configured) return path.resolve(configured);
    return path.resolve(process.cwd(), 'data', 'uploads');
  }

  tenantCertDir(tenantSlug: string): string {
    return path.join(this.getUploadRoot(), 'tenants', tenantSlug, 'certs');
  }

  absolutePath(tenantSlug: string): string {
    return path.join(this.tenantCertDir(tenantSlug), CERT_BASENAME);
  }

  isManagedPath(tenantSlug: string, filePath: string | null | undefined): boolean {
    const p = filePath?.trim();
    if (!p) return false;
    try {
      return path.resolve(p) === path.resolve(this.absolutePath(tenantSlug));
    } catch {
      return false;
    }
  }

  assertPfxUpload(file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number }): Buffer {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Nenhum arquivo .pfx enviado.');
    }
    const size = file.size ?? file.buffer.length;
    if (size > MAX_BYTES) {
      throw new BadRequestException('Arquivo muito grande. Máximo 5 MB para o certificado A1.');
    }
    const name = (file.originalname ?? '').toLowerCase();
    const mime = (file.mimetype ?? '').toLowerCase();
    const okExt = name.endsWith('.pfx') || name.endsWith('.p12');
    const okMime =
      !mime ||
      mime === 'application/x-pkcs12' ||
      mime === 'application/pkcs12' ||
      mime === 'application/octet-stream';
    if (!okExt && !okMime) {
      throw new BadRequestException('Envie um certificado A1 (.pfx ou .p12).');
    }
    if (!okExt) {
      throw new BadRequestException('Extensão inválida. Use .pfx ou .p12.');
    }
    return file.buffer;
  }

  async save(tenantSlug: string, buffer: Buffer): Promise<string> {
    const dir = this.tenantCertDir(tenantSlug);
    await fs.mkdir(dir, { recursive: true });
    const dest = this.absolutePath(tenantSlug);
    await fs.writeFile(dest, buffer, { mode: 0o600 });
    return dest;
  }
}
