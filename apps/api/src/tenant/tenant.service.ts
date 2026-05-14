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

  async assertLicenseActive(slug: string): Promise<void> {
    const tenant = await this.central.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      throw new ForbiddenException('Tenant inválido');
    }
    const ok: LicenseStatus[] = [LicenseStatus.active, LicenseStatus.trial];
    if (!ok.includes(tenant.licenseStatus)) {
      throw new ForbiddenException('Licença inativa ou expirada para este CNPJ');
    }
    if (tenant.licenseExpiresAt && tenant.licenseExpiresAt < new Date()) {
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
}
