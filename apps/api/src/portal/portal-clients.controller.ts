import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LicenseStatus,
  PlanCode,
  TenantProvisioningStatus,
} from '../generated/central-client';
import {
  assertValidTenantDatabaseName,
  buildTenantDatabaseUrl,
} from '../provisioning/tenant-database-name';
import { seedTenantMinimal } from '../provisioning/tenant-minimal-seed';
import { TenantProvisioningService } from '../provisioning/tenant-provisioning.service';
import { CentralPrismaService } from '../prisma/central-prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PortalAuthGuard } from './portal-auth.guard';
import { TenantService } from '../tenant/tenant.service';

function slugify(input: string): string {
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tenant';
}

function onlyDigits(s: string): string {
  return String(s ?? '').replace(/\D+/g, '');
}

function parseDate(s: unknown): Date | null {
  if (!s) return null;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseMonthlyFee(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException('Informe um valor de mensalidade válido (≥ 0).');
  }
  return n.toFixed(2);
}

@Controller('portal/clients')
@UseGuards(PortalAuthGuard)
export class PortalClientsController {
  constructor(
    private readonly central: CentralPrismaService,
    private readonly config: ConfigService,
    private readonly provisioning: TenantProvisioningService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tenantService: TenantService,
  ) {}

  /** Lista todos os clientes/licenças com cálculo de tempo restante. */
  @Get()
  async list() {
    const raw = await this.central.tenant.findMany({
      orderBy: { companyName: 'asc' },
    });
    const tenants = await Promise.all(
      raw.map((t) => this.tenantService.syncLicenseExpiryStatus(t)),
    );
    const now = Date.now();
    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      cnpj: t.cnpj,
      companyName: t.companyName,
      planCode: t.planCode,
      licenseStatus: t.licenseStatus,
      licenseValidFrom: t.licenseValidFrom,
      licenseExpiresAt: t.licenseExpiresAt,
      licenseLastValidatedAt: t.licenseLastValidatedAt,
      remainingDays:
        t.licenseExpiresAt
          ? Math.ceil((new Date(t.licenseExpiresAt).getTime() - now) / (24 * 60 * 60 * 1000))
          : null,
      databaseName: t.databaseName,
      provisioningStatus: t.provisioningStatus,
      provisioningError: t.provisioningError,
      provisioningUpdatedAt: t.provisioningUpdatedAt,
      provisionAdminEmail: t.provisionAdminEmail,
      monthlyFee: t.monthlyFee != null ? String(t.monthlyFee) : null,
      createdAt: t.createdAt,
    }));
  }

  /** Reexecuta CREATE DATABASE + migrate + seed (após falha ou pendente travado). */
  @Post(':cnpj/provision')
  async retryProvision(
    @Param('cnpj') cnpjParam: string,
    @Body()
    body: {
      firstAdminEmail?: string;
      firstAdminPassword?: string;
    } = {},
  ) {
    const cnpj = onlyDigits(cnpjParam);
    const tenant = await this.central.tenant.findUnique({ where: { cnpj } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado.');
    if (tenant.provisioningStatus === TenantProvisioningStatus.READY) {
      throw new BadRequestException('Este cliente já está provisionado.');
    }
    if (tenant.provisioningStatus === TenantProvisioningStatus.PROVISIONING) {
      throw new BadRequestException('Provisionamento em andamento. Aguarde ou tente mais tarde.');
    }
    const adminEmail =
      (body.firstAdminEmail && body.firstAdminEmail.trim()) ||
      tenant.provisionAdminEmail ||
      `admin.${tenant.slug.replace(/-/g, '_')}@gestorvend.local`;
    const adminPassword =
      (body.firstAdminPassword && body.firstAdminPassword.trim()) || 'Admin123!';
    this.provisioning.scheduleProvision(tenant.id, {
      adminEmail: adminEmail.toLowerCase(),
      adminPassword,
    });
    return this.central.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
  }

  /**
   * Reaplica só o seed mínimo (usuário admin + papéis) no banco já existente.
   * Útil quando o operador tentou login com outro e-mail/senha que o registrado no catálogo.
   */
  @Post(':cnpj/admin-seed')
  async reseedFirstAdmin(
    @Param('cnpj') cnpjParam: string,
    @Body()
    body: {
      firstAdminEmail?: string;
      firstAdminPassword?: string;
    } = {},
  ) {
    const cnpj = onlyDigits(cnpjParam);
    if (cnpj.length !== 14) {
      throw new BadRequestException('CNPJ deve ter 14 dígitos.');
    }
    const tenant = await this.central.tenant.findUnique({ where: { cnpj } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado.');
    if (tenant.provisioningStatus !== TenantProvisioningStatus.READY) {
      throw new BadRequestException(
        'Disponível apenas com provisionamento concluído. Use "Processar" / "Tentar de novo" antes.',
      );
    }
    let databaseName: string;
    try {
      databaseName = assertValidTenantDatabaseName(tenant.databaseName);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const template = this.config.get<string>('TENANT_DATABASE_URL')?.trim();
    if (!template) {
      throw new BadRequestException('TENANT_DATABASE_URL não configurada.');
    }
    const tenantUrl = buildTenantDatabaseUrl(template, databaseName);
    const adminEmail = (
      (body.firstAdminEmail && body.firstAdminEmail.trim()) ||
      tenant.provisionAdminEmail ||
      `admin.${tenant.slug.replace(/-/g, '_')}@gestorvend.local`
    ).toLowerCase();
    const adminPassword =
      (body.firstAdminPassword && body.firstAdminPassword.trim()) || 'Admin123!';

    await seedTenantMinimal(tenantUrl, { adminEmail, adminPassword });
    await this.central.tenant.update({
      where: { id: tenant.id },
      data: { provisionAdminEmail: adminEmail },
    });
    this.tenantPrisma.invalidateClient(tenant.slug);
    return { ok: true as const, provisionAdminEmail: adminEmail };
  }

  /** Cria um novo cliente + licença inicial e enfileira provisionamento do banco (assíncrono). */
  @Post()
  async create(
    @Body()
    body: {
      cnpj: string;
      companyName: string;
      slug?: string;
      databaseName?: string;
      planCode?: PlanCode;
      licenseStatus?: LicenseStatus;
      licenseValidFrom?: string | null;
      licenseExpiresAt?: string | null;
      /** E-mail do primeiro admin do tenant (padrão: admin.<slug>@gestorvend.local). */
      firstAdminEmail?: string;
      /** Senha do primeiro admin (padrão interna Admin123!). */
      firstAdminPassword?: string;
      monthlyFee?: number | string | null;
    },
  ) {
    const cnpj = onlyDigits(body.cnpj);
    if (cnpj.length !== 14) {
      throw new BadRequestException('CNPJ deve ter 14 dígitos.');
    }
    const companyName = String(body.companyName ?? '').trim();
    if (!companyName) {
      throw new BadRequestException('Informe a razão social.');
    }
    const slug = body.slug?.trim() ? slugify(body.slug.trim()) : slugify(companyName);
    const databaseBase =
      (body.databaseName?.trim().replace(/-/g, '_').toLowerCase()) ||
      `gv_tenant_${slug.replace(/-/g, '_')}`;

    const ensureUniqueSlug = async (base: string) => {
      let candidate = base;
      let i = 1;
      while (await this.central.tenant.findFirst({ where: { slug: candidate } })) {
        candidate = `${base}-${++i}`;
      }
      return candidate;
    };
    const ensureUniqueDatabaseName = async (base: string) => {
      let candidate = base;
      let i = 1;
      while (
        await this.central.tenant.findFirst({ where: { databaseName: candidate } })
      ) {
        candidate = `${base}_${++i}`;
      }
      return candidate;
    };
    try {
      assertValidTenantDatabaseName(databaseBase);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const uniqueSlug = await ensureUniqueSlug(slug);
    const uniqueDb = await ensureUniqueDatabaseName(databaseBase);
    try {
      assertValidTenantDatabaseName(uniqueDb);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const adminEmail =
      (body.firstAdminEmail && body.firstAdminEmail.trim()) ||
      `admin.${uniqueSlug.replace(/-/g, '_')}@gestorvend.local`;
    const adminPassword =
      (body.firstAdminPassword && body.firstAdminPassword.trim()) || 'Admin123!';

    const created = await this.central.tenant.create({
      data: {
        slug: uniqueSlug,
        databaseName: uniqueDb,
        cnpj,
        companyName,
        planCode: body.planCode ?? PlanCode.STANDARD,
        licenseStatus: body.licenseStatus ?? LicenseStatus.trial,
        licenseValidFrom: parseDate(body.licenseValidFrom),
        licenseExpiresAt: parseDate(body.licenseExpiresAt),
        provisioningStatus: TenantProvisioningStatus.PENDING,
        provisionAdminEmail: adminEmail.toLowerCase(),
        monthlyFee: parseMonthlyFee(body.monthlyFee),
      },
    });
    this.provisioning.scheduleProvision(created.id, {
      adminEmail: adminEmail.toLowerCase(),
      adminPassword,
    });
    return created;
  }

  /** Atualiza dados gerais e da licença. Aceita por CNPJ na URL para alinhar
   *  com o que o plano sugere (`PATCH /portal/clients/:cnpj/license`). */
  @Patch(':cnpj/license')
  async updateLicense(
    @Param('cnpj') cnpjParam: string,
    @Body()
    body: {
      planCode?: PlanCode;
      licenseStatus?: LicenseStatus;
      licenseValidFrom?: string | null;
      licenseExpiresAt?: string | null;
      companyName?: string;
      /** Atalho: adicionar N dias na licença a partir de hoje. */
      renewDays?: number;
    },
  ) {
    const cnpj = onlyDigits(cnpjParam);
    const tenant = await this.central.tenant.findUnique({ where: { cnpj } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado.');

    const data: Record<string, unknown> = {
      licenseLastValidatedAt: new Date(),
    };
    if (body.planCode !== undefined) data.planCode = body.planCode;
    if (body.licenseStatus !== undefined) data.licenseStatus = body.licenseStatus;
    if (body.companyName !== undefined && body.companyName.trim()) {
      data.companyName = body.companyName.trim();
    }
    if (body.licenseValidFrom !== undefined) {
      data.licenseValidFrom = parseDate(body.licenseValidFrom);
    }
    if (body.licenseExpiresAt !== undefined) {
      data.licenseExpiresAt = parseDate(body.licenseExpiresAt);
    }
    if (typeof body.renewDays === 'number' && body.renewDays > 0) {
      const base = new Date();
      base.setDate(base.getDate() + Math.floor(body.renewDays));
      data.licenseExpiresAt = base;
      // Se a licença estava expirada/suspensa, considera reativada.
      if (
        tenant.licenseStatus === LicenseStatus.expired ||
        tenant.licenseStatus === LicenseStatus.suspended
      ) {
        data.licenseStatus = LicenseStatus.active;
      }
      data.licenseValidFrom = data.licenseValidFrom ?? new Date();
    }
    return this.central.tenant.update({ where: { id: tenant.id }, data });
  }

  /**
   * Sem `purge`: só desativa a licença (linha permanece no catálogo).
   * Com `purge=1` e tenant **não** READY: remove o registro do catálogo (libera CNPJ/slug);
   * o banco PostgreSQL do tenant, se existir, **não** é apagado.
   */
  @Delete(':cnpj')
  async deactivate(
    @Param('cnpj') cnpjParam: string,
    @Query('purge') purge?: string,
  ) {
    const cnpj = onlyDigits(cnpjParam);
    const tenant = await this.central.tenant.findUnique({ where: { cnpj } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado.');

    const wantPurge = purge === '1' || purge === 'true';
    if (wantPurge) {
      if (tenant.provisioningStatus === TenantProvisioningStatus.READY) {
        throw new BadRequestException(
          'Cliente já provisionado: use a desativação normal ou contate o suporte para remover dados.',
        );
      }
      this.tenantPrisma.invalidateClient(tenant.slug);
      await this.central.tenant.delete({ where: { id: tenant.id } });
      return { purged: true };
    }

    return this.central.tenant.update({
      where: { id: tenant.id },
      data: {
        licenseStatus: LicenseStatus.expired,
        licenseExpiresAt: new Date(),
      },
    });
  }
}
