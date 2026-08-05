import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LicenseStatus, PlanCode, Tenant } from '../generated/central-client';
import { CentralPrismaService } from '../prisma/central-prisma.service';

@Injectable()
export class TenantService {
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
      return this.central.tenant.update({
        where: { id: tenant.id },
        data: { licenseStatus: LicenseStatus.expired },
      });
    }
    return tenant;
  }

  async assertLicenseActive(slug: string): Promise<void> {
    let tenant = await this.central.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      throw new ForbiddenException('Tenant inválido');
    }

    tenant = await this.syncLicenseExpiryStatus(tenant);

    const now = new Date();
    const ok: LicenseStatus[] = [LicenseStatus.active, LicenseStatus.trial];
    if (!ok.includes(tenant.licenseStatus)) {
      if (tenant.licenseStatus === LicenseStatus.suspended) {
        throw new ForbiddenException('Licença suspensa. Entre em contato com o suporte.');
      }
      throw new ForbiddenException('Licença inativa ou expirada para este CNPJ');
    }
    if (tenant.licenseExpiresAt && tenant.licenseExpiresAt < now) {
      throw new ForbiddenException('Licença expirada');
    }

    // Carimbo de validação — usado pelo portal para auditoria de uso.
    await this.central.tenant.update({
      where: { id: tenant.id },
      data: { licenseLastValidatedAt: new Date() },
    });
  }

  /**
   * Garante que o tenant possui um dos planos exigidos. Útil para liberar/bloquear
   * funcionalidades opcionais (ex.: módulo WhatsApp).
   */
  async assertPlan(slug: string, allowed: PlanCode[]): Promise<PlanCode> {
    const tenant = await this.getBySlug(slug);
    if (!allowed.includes(tenant.planCode)) {
      throw new ForbiddenException(
        `Funcionalidade não incluída no plano "${tenant.planCode}". Planos com acesso: ${allowed.join(', ')}.`,
      );
    }
    return tenant.planCode;
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
