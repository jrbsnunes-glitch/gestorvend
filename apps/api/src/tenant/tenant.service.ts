import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LicenseStatus,
  PlanCode,
  Tenant,
  TenantModuleAddon,
} from '../generated/central-client';
import { CentralPrismaService } from '../prisma/central-prisma.service';

type LicenseCacheEntry =
  | { ok: true; checkedAt: number; planCode: PlanCode }
  | { ok: false; checkedAt: number; message: string };

/** Evita SELECT+UPDATE no banco central a cada request JWT. */
const LICENSE_CACHE_TTL_MS = 60_000;
/** Carimbo licenseLastValidatedAt no máximo a cada 5 min por tenant. */
const LICENSE_STAMP_MIN_MS = 5 * 60_000;
const PLAN_CACHE_TTL_MS = 60_000;
const MODULE_CACHE_TTL_MS = 60_000;

@Injectable()
export class TenantService {
  private readonly licenseCache = new Map<string, LicenseCacheEntry>();
  private readonly lastStampAt = new Map<string, number>();
  private readonly planCache = new Map<string, { planCode: PlanCode; checkedAt: number }>();
  private readonly moduleCache = new Map<
    string,
    { modules: TenantModuleAddon[]; checkedAt: number }
  >();

  constructor(private readonly central: CentralPrismaService) {}

  /** Busca o tenant pelo slug ou lança 404 — usado por guards e bridge. */
  async getBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.central.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      throw new NotFoundException(`Tenant "${slug}" não encontrado`);
    }
    return tenant;
  }

  /** Sincroniza status `expired` quando a data de validade já passou. */
  async syncLicenseExpiryStatus(tenant: Tenant): Promise<Tenant> {
    const now = new Date();
    if (
      tenant.licenseExpiresAt &&
      tenant.licenseExpiresAt < now &&
      (tenant.licenseStatus === LicenseStatus.active ||
        tenant.licenseStatus === LicenseStatus.trial)
    ) {
      this.invalidateCaches(tenant.slug);
      return this.central.tenant.update({
        where: { id: tenant.id },
        data: { licenseStatus: LicenseStatus.expired },
      });
    }
    return tenant;
  }

  invalidateCaches(slug: string): void {
    this.licenseCache.delete(slug);
    this.planCache.delete(slug);
    this.moduleCache.delete(slug);
  }

  async getEnabledModules(slug: string): Promise<TenantModuleAddon[]> {
    const now = Date.now();
    const cached = this.moduleCache.get(slug);
    if (cached && now - cached.checkedAt < MODULE_CACHE_TTL_MS) {
      return cached.modules;
    }
    const tenant = await this.central.tenant.findUnique({
      where: { slug },
      include: { moduleGrants: { select: { module: true } } },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant "${slug}" não encontrado`);
    }
    const modules = tenant.moduleGrants.map((g) => g.module);
    this.moduleCache.set(slug, { modules, checkedAt: now });
    return modules;
  }

  async getEnabledModulesByTenantId(tenantId: string): Promise<TenantModuleAddon[]> {
    const grants = await this.central.tenantModuleGrant.findMany({
      where: { tenantId },
      select: { module: true },
    });
    return grants.map((g) => g.module);
  }

  async setEnabledModules(
    tenantId: string,
    slug: string,
    modules: TenantModuleAddon[],
  ): Promise<TenantModuleAddon[]> {
    const wanted = [...new Set(modules)];
    const existing = await this.central.tenantModuleGrant.findMany({
      where: { tenantId },
    });
    const existingSet = new Set(existing.map((g) => g.module));
    const wantedSet = new Set(wanted);

    const toDelete = existing.filter((g) => !wantedSet.has(g.module)).map((g) => g.id);
    if (toDelete.length) {
      await this.central.tenantModuleGrant.deleteMany({
        where: { id: { in: toDelete } },
      });
    }
    for (const mod of wanted) {
      if (!existingSet.has(mod)) {
        await this.central.tenantModuleGrant.create({
          data: { tenantId, module: mod },
        });
      }
    }
    this.invalidateCaches(slug);
    return wanted;
  }

  /**
   * Garante que o tenant possui o módulo adicional contratado no portal.
   */
  async assertModule(slug: string, module: TenantModuleAddon): Promise<void> {
    const modules = await this.getEnabledModules(slug);
    if (!modules.includes(module)) {
      const label =
        module === TenantModuleAddon.SERVICE_ORDER
          ? 'Ordem de Serviços'
          : String(module);
      throw new ForbiddenException(
        `Módulo ${label} não contratado. Contate o suporte GestorVend.`,
      );
    }
  }

  async assertLicenseActive(slug: string): Promise<void> {
    const now = Date.now();
    const cached = this.licenseCache.get(slug);
    if (cached && now - cached.checkedAt < LICENSE_CACHE_TTL_MS) {
      if (!cached.ok) throw new ForbiddenException(cached.message);
      return;
    }

    let tenant = await this.central.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      this.licenseCache.set(slug, {
        ok: false,
        checkedAt: now,
        message: 'Tenant inválido',
      });
      throw new ForbiddenException('Tenant inválido');
    }

    tenant = await this.syncLicenseExpiryStatus(tenant);

    const okStatuses: LicenseStatus[] = [LicenseStatus.active, LicenseStatus.trial];
    if (!okStatuses.includes(tenant.licenseStatus)) {
      const message =
        tenant.licenseStatus === LicenseStatus.suspended
          ? 'Licença suspensa. Entre em contato com o suporte.'
          : 'Licença inativa ou expirada para este CNPJ';
      this.licenseCache.set(slug, { ok: false, checkedAt: now, message });
      throw new ForbiddenException(message);
    }
    if (tenant.licenseExpiresAt && tenant.licenseExpiresAt < new Date()) {
      const message = 'Licença expirada';
      this.licenseCache.set(slug, { ok: false, checkedAt: now, message });
      throw new ForbiddenException(message);
    }

    this.licenseCache.set(slug, {
      ok: true,
      checkedAt: now,
      planCode: tenant.planCode,
    });
    this.planCache.set(slug, { planCode: tenant.planCode, checkedAt: now });

    const lastStamp = this.lastStampAt.get(slug) ?? 0;
    if (now - lastStamp >= LICENSE_STAMP_MIN_MS) {
      this.lastStampAt.set(slug, now);
      void this.central.tenant
        .update({
          where: { id: tenant.id },
          data: { licenseLastValidatedAt: new Date() },
        })
        .catch(() => undefined);
    }
  }

  async assertPlan(slug: string, allowed: PlanCode[]): Promise<PlanCode> {
    const now = Date.now();
    const cached = this.planCache.get(slug);
    let planCode: PlanCode;
    if (cached && now - cached.checkedAt < PLAN_CACHE_TTL_MS) {
      planCode = cached.planCode;
    } else {
      const licenseHit = this.licenseCache.get(slug);
      if (
        licenseHit?.ok &&
        now - licenseHit.checkedAt < LICENSE_CACHE_TTL_MS
      ) {
        planCode = licenseHit.planCode;
      } else {
        const tenant = await this.getBySlug(slug);
        planCode = tenant.planCode;
        this.planCache.set(slug, { planCode, checkedAt: now });
      }
    }

    if (!allowed.includes(planCode)) {
      throw new ForbiddenException(
        `Funcionalidade não incluída no plano "${planCode}". Planos com acesso: ${allowed.join(', ')}.`,
      );
    }
    return planCode;
  }

  async getPublicLicenseStatus(slug: string): Promise<{
    ok: boolean;
    status: string;
    planCode: string | null;
    enabledModules: TenantModuleAddon[];
    expiresAt: string | null;
    remainingDays: number | null;
    message?: string;
  }> {
    const raw = await this.central.tenant.findUnique({
      where: { slug },
      include: { moduleGrants: { select: { module: true } } },
    });
    if (!raw) {
      return {
        ok: false,
        status: 'not_found',
        planCode: null,
        enabledModules: [],
        expiresAt: null,
        remainingDays: null,
        message: 'Empresa não encontrada.',
      };
    }

    const { moduleGrants, ...tenantFields } = raw;
    const tenant = await this.syncLicenseExpiryStatus(tenantFields);
    const now = new Date();
    const expiresAt = tenant.licenseExpiresAt
      ? tenant.licenseExpiresAt.toISOString()
      : null;
    let remainingDays: number | null = null;
    if (tenant.licenseExpiresAt) {
      remainingDays = Math.ceil(
        (tenant.licenseExpiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
    }

    const activeStatuses: LicenseStatus[] = [LicenseStatus.active, LicenseStatus.trial];
    const ok =
      activeStatuses.includes(tenant.licenseStatus) &&
      (!tenant.licenseExpiresAt || tenant.licenseExpiresAt >= now);

    let message: string | undefined;
    if (!ok) {
      if (tenant.licenseStatus === LicenseStatus.suspended) {
        message = 'Licença suspensa. Entre em contato com o suporte.';
      } else if (
        tenant.licenseStatus === LicenseStatus.expired ||
        (tenant.licenseExpiresAt && tenant.licenseExpiresAt < now)
      ) {
        message = 'Licença expirada.';
      } else {
        message = 'Licença inativa.';
      }
    }

    return {
      ok,
      status: tenant.licenseStatus,
      planCode: tenant.planCode,
      enabledModules: moduleGrants.map((g) => g.module),
      expiresAt,
      remainingDays,
      message,
    };
  }
}
