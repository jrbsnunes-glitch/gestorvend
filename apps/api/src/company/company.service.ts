import { BadRequestException, Injectable } from '@nestjs/common';
import { validateCnpj14 } from '../common/cnpj.util';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { CompanyLogoStorage } from './company-logo.storage';

type CompanyInput = {
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  ie?: string | null;
  im?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  logoUrl?: string | null;
  saleReceiptAutoPrint?: boolean;
  saleReceiptPrinterHint?: string | null;
  pdvDocumentMode?: 'NON_FISCAL_RECEIPT' | 'ELECTRONIC_FISCAL_PLANNED' | string;
  restaurantModuleEnabled?: boolean;
  scaleMode?: 'MANUAL' | 'SERIAL_DIRECT' | 'AGENT' | 'BARCODE_LABEL' | string;
  scaleProfile?: string | null;
  barcodeWeightPattern?: string | null;
  scaleAutoConfirmMs?: number;
  scaleHint?: string | null;
  kitchenPrinterHint?: string | null;
  serviceFeeEnabled?: boolean;
  serviceFeeMode?: 'PERCENT' | 'FIXED' | string;
  serviceFeeValue?: number | string;
  couvertEnabled?: boolean;
  couvertMode?: 'PERCENT' | 'FIXED' | string;
  couvertValue?: number | string;
  waiterTipEnabled?: boolean;
  waiterTipMode?: 'PERCENT' | 'FIXED' | string;
  waiterTipValue?: number | string;
};

/**
 * Mantém o cadastro da empresa do tenant. O registro é singleton — sempre
 * existe um único `Company`. Se a tabela estiver vazia (primeiro acesso),
 * inicializamos a partir dos campos `cnpj`/`companyName` que o banco central
 * já guarda em `Tenant`.
 */
@Injectable()
export class CompanyService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tenants: TenantService,
    private readonly logos: CompanyLogoStorage,
  ) {}

  async getOrCreate(tenantSlug: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const existing = await db.company.findFirst();
    if (existing) return existing;

    // Seed a partir dos dados do tenant central, para o usuário não começar do zero.
    const tenant = await this.tenants.getBySlug(tenantSlug);
    return db.company.create({
      data: {
        legalName: tenant?.companyName ?? 'Minha Empresa',
        tradeName: tenant?.companyName ?? 'Minha Empresa',
        cnpj: tenant?.cnpj ?? '',
      },
    });
  }

  async update(tenantSlug: string, body: CompanyInput) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const current = await this.getOrCreate(tenantSlug);

    const data: Record<string, unknown> = {};
    const trimOrNull = (v: unknown) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const s = String(v).trim();
      return s.length === 0 ? null : s;
    };
    const trimRequired = (v: unknown, label: string) => {
      if (v === undefined) return undefined;
      const s = String(v ?? '').trim();
      if (s.length === 0) {
        throw new BadRequestException(`${label} é obrigatório.`);
      }
      return s;
    };

    const legalName = trimRequired(body.legalName, 'Razão social');
    if (legalName !== undefined) data.legalName = legalName;
    const tradeName = trimRequired(body.tradeName, 'Nome fantasia');
    if (tradeName !== undefined) data.tradeName = tradeName;
    const cnpjRaw = trimRequired(body.cnpj, 'CNPJ');
    if (cnpjRaw !== undefined) {
      const checked = validateCnpj14(cnpjRaw);
      if (!checked.ok) {
        throw new BadRequestException(checked.reason);
      }
      data.cnpj = checked.cnpj;
    }

    const optional: (keyof CompanyInput)[] = [
      'ie',
      'im',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'zip',
      'logoUrl',
      'saleReceiptPrinterHint',
      'scaleProfile',
      'barcodeWeightPattern',
      'scaleHint',
      'kitchenPrinterHint',
    ];
    for (const k of optional) {
      const v = trimOrNull(body[k]);
      if (v !== undefined) data[k] = v;
    }

    if (body.saleReceiptAutoPrint !== undefined) {
      data.saleReceiptAutoPrint = Boolean(body.saleReceiptAutoPrint);
    }

    if (body.restaurantModuleEnabled !== undefined) {
      data.restaurantModuleEnabled = Boolean(body.restaurantModuleEnabled);
    }

    if (body.scaleAutoConfirmMs !== undefined) {
      const n = Number(body.scaleAutoConfirmMs);
      if (!Number.isFinite(n) || n < 0 || n > 30_000) {
        throw new BadRequestException('scaleAutoConfirmMs inválido (0–30000).');
      }
      data.scaleAutoConfirmMs = Math.round(n);
    }

    if (body.scaleMode !== undefined) {
      const m = String(body.scaleMode).trim();
      if (!['MANUAL', 'SERIAL_DIRECT', 'AGENT', 'BARCODE_LABEL'].includes(m)) {
        throw new BadRequestException('Modo de balança inválido.');
      }
      data.scaleMode = m;
    }

    if (body.pdvDocumentMode !== undefined) {
      const m = String(body.pdvDocumentMode).trim();
      if (m !== 'NON_FISCAL_RECEIPT' && m !== 'ELECTRONIC_FISCAL_PLANNED') {
        throw new BadRequestException(
          'Modo de documento do PDV inválido (use apenas comprovante interno ou planejamento de documento fiscal).',
        );
      }
      data.pdvDocumentMode = m;
    }

    const parseFeeMode = (raw: unknown, label: string): 'PERCENT' | 'FIXED' | undefined => {
      if (raw === undefined) return undefined;
      const m = String(raw).trim().toUpperCase();
      if (m !== 'PERCENT' && m !== 'FIXED') {
        throw new BadRequestException(`${label}: use PERCENT ou FIXED.`);
      }
      return m;
    };
    const parseFeeValue = (raw: unknown, label: string): number | undefined => {
      if (raw === undefined) return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        throw new BadRequestException(`${label} inválido.`);
      }
      return n;
    };

    if (body.serviceFeeEnabled !== undefined) {
      data.serviceFeeEnabled = Boolean(body.serviceFeeEnabled);
    }
    const serviceFeeMode = parseFeeMode(body.serviceFeeMode, 'Modo da taxa de serviço');
    if (serviceFeeMode !== undefined) data.serviceFeeMode = serviceFeeMode;
    const serviceFeeValue = parseFeeValue(body.serviceFeeValue, 'Valor da taxa de serviço');
    if (serviceFeeValue !== undefined) data.serviceFeeValue = String(serviceFeeValue);

    if (body.couvertEnabled !== undefined) {
      data.couvertEnabled = Boolean(body.couvertEnabled);
    }
    const couvertMode = parseFeeMode(body.couvertMode, 'Modo do couvert');
    if (couvertMode !== undefined) data.couvertMode = couvertMode;
    const couvertValue = parseFeeValue(body.couvertValue, 'Valor do couvert');
    if (couvertValue !== undefined) data.couvertValue = String(couvertValue);

    if (body.waiterTipEnabled !== undefined) {
      data.waiterTipEnabled = Boolean(body.waiterTipEnabled);
    }
    const waiterTipMode = parseFeeMode(body.waiterTipMode, 'Modo da taxa do garçom');
    if (waiterTipMode !== undefined) data.waiterTipMode = waiterTipMode;
    const waiterTipValue = parseFeeValue(body.waiterTipValue, 'Valor da taxa do garçom');
    if (waiterTipValue !== undefined) data.waiterTipValue = String(waiterTipValue);

    return db.company.update({ where: { id: current.id }, data });
  }

  async uploadLogo(
    tenantSlug: string,
    file: { buffer: Buffer; mimetype?: string; size?: number } | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }
    const maxBytes = 2 * 1024 * 1024;
    if (file.size != null && file.size > maxBytes) {
      throw new BadRequestException('Arquivo muito grande. Máximo 2 MB.');
    }
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException('Arquivo muito grande. Máximo 2 MB.');
    }

    const logoUrl = await this.logos.save(tenantSlug, file.buffer, file.mimetype ?? '');
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const current = await this.getOrCreate(tenantSlug);
    return db.company.update({
      where: { id: current.id },
      data: { logoUrl },
    });
  }
}
