import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Armazena XML de NF-e/NFC-e emitidas (saída) por tenant. */
@Injectable()
export class OutboundNfeStorage {
  constructor(private readonly config: ConfigService) {}

  getRoot(): string {
    const configured = this.config.get<string>('NFE_OUTBOUND_DIR')?.trim();
    if (configured) return path.resolve(configured);
    const upload = this.config.get<string>('UPLOAD_DIR')?.trim();
    if (upload) return path.resolve(upload, '..', 'nfe-outbound');
    return path.resolve(process.cwd(), 'data', 'nfe-outbound');
  }

  tenantDir(tenantSlug: string): string {
    return path.join(this.getRoot(), 'tenants', tenantSlug);
  }

  xmlPathForKey(tenantSlug: string, accessKey: string): string {
    return path.join(this.tenantDir(tenantSlug), `${accessKey}.xml`);
  }

  async saveXml(
    tenantSlug: string,
    accessKey: string,
    xml: string,
  ): Promise<{ path: string; sha256: string }> {
    const dir = this.tenantDir(tenantSlug);
    await fs.mkdir(dir, { recursive: true });
    const filePath = this.xmlPathForKey(tenantSlug, accessKey);
    await fs.writeFile(filePath, xml, 'utf8');
    const sha256 = crypto.createHash('sha256').update(xml, 'utf8').digest('hex');
    return { path: filePath, sha256 };
  }

  /**
   * Cópia do XML que a SEFAZ recusou (215/999). Não entra na retransmissão:
   * o arquivo oficial continua `{chave}.xml`.
   */
  async saveRejectedXml(
    tenantSlug: string,
    accessKey: string,
    xml: string,
  ): Promise<{ path: string; sha256: string; name: string }> {
    const key = accessKey.replace(/\D/g, '').slice(0, 44);
    const dir = this.tenantDir(tenantSlug);
    await fs.mkdir(dir, { recursive: true });
    const name = `${key}-rejeitado.xml`;
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, xml, 'utf8');
    const sha256 = crypto.createHash('sha256').update(xml, 'utf8').digest('hex');
    return { path: filePath, sha256, name };
  }

  async readXml(tenantSlug: string, accessKey: string): Promise<string | null> {
    try {
      return await fs.readFile(this.xmlPathForKey(tenantSlug, accessKey), 'utf8');
    } catch {
      return null;
    }
  }
}
