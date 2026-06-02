import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class InboundNfeStorage {
  constructor(private readonly config: ConfigService) {}

  getRoot(): string {
    const configured = this.config.get<string>('NFE_INBOUND_DIR')?.trim();
    if (configured) return path.resolve(configured);
    const upload = this.config.get<string>('UPLOAD_DIR')?.trim();
    if (upload) return path.resolve(upload, '..', 'nfe-inbound');
    return path.resolve(process.cwd(), 'data', 'nfe-inbound');
  }

  tenantDir(tenantSlug: string): string {
    return path.join(this.getRoot(), 'tenants', tenantSlug);
  }

  xmlPathForKey(tenantSlug: string, accessKey: string): string {
    return path.join(this.tenantDir(tenantSlug), `${accessKey}.xml`);
  }

  async saveXml(tenantSlug: string, accessKey: string, xml: string): Promise<{ path: string; sha256: string }> {
    const dir = this.tenantDir(tenantSlug);
    await fs.mkdir(dir, { recursive: true });
    const filePath = this.xmlPathForKey(tenantSlug, accessKey);
    await fs.writeFile(filePath, xml, 'utf8');
    const sha256 = crypto.createHash('sha256').update(xml, 'utf8').digest('hex');
    return { path: filePath, sha256 };
  }

  async readXml(tenantSlug: string, accessKey: string): Promise<string | null> {
    try {
      return await fs.readFile(this.xmlPathForKey(tenantSlug, accessKey), 'utf8');
    } catch {
      return null;
    }
  }
}
