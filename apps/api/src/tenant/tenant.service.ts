import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LicenseStatus, PlanCode, Tenant } from '../generated/central-client';
import { CentralPrismaService } from '../prisma/central-prisma.service';

type LicenseCacheEntry =
  | { ok: true; checkedAt: number; planCode: PlanCode }
  | { ok: false; checkedAt: number; message: string };

/** Evita SELECT+UPDATE no banco central a cada request JWT. */
const LICENSE_CACHE_TTL_MS = 60_000;
/** Carimbo licenseLastValidatedAt no máximo a cada 5 min por tenant. */
const LICENSE_STAMP_MIN_MS = 5 * 60_000;
const PLAN_CACHE_TTL_MS = 60_000;

@Injectable()
export class TenantService {
  private readonly licenseCache = new Map<string, LicenseCacheEntry>();
  private readonly lastStampAt = new Map<string, number>();
  private readonly planCache = new Map<string, { planCode: PlanCode; checkedAt: number }>();

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

    // Carimbo de auditoria — throttle (não em toda request).
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

  /**
   * Garante que o tenant possui um dos planos exigidos. Útil para liberar/bloquear
   * funcionalidades opcionais (ex.: módulo WhatsApp).
   */
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

  /**
   * Status público e enxuto da licença (app desktop / checagem antecipada).
   * Não expõe dados sensíveis do tenant.
   */
  async getPublicLicenseStatus(slug: string): Promise<{
    ok: boolean;
    status: string;
    planCode: string | null;
    expiresAt: string | null;
    remainingDays: number | null;
    message?: string;
  }> {
    const raw = await this.central.tenant.findUnique({ where: { slug } });
    if (!raw) {
      return {
        ok: false,
        status: 'not_found',
        planCode: null,
        expiresAt: null,
        remainingDays: null,
        message: 'Empresa não encontrada.',
      };
    }

    const tenant = await this.syncLicenseExpiryStatus(raw);
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
      expiresAt,
      remainingDays,
      message,
    };
  }
}
