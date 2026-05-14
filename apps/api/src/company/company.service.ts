import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantService } from '../tenant/tenant.service';

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
    const cnpj = trimRequired(body.cnpj, 'CNPJ');
    if (cnpj !== undefined) data.cnpj = cnpj;

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
    ];
    for (const k of optional) {
      const v = trimOrNull(body[k]);
      if (v !== undefined) data[k] = v;
    }

    if (body.saleReceiptAutoPrint !== undefined) {
      data.saleReceiptAutoPrint = Boolean(body.saleReceiptAutoPrint);
    }

    return db.company.update({ where: { id: current.id }, data });
  }
}
