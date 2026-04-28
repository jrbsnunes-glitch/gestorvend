import { ForbiddenException, Injectable } from '@nestjs/common';
import { LicenseStatus } from '../generated/central-client';
import { CentralPrismaService } from '../prisma/central-prisma.service';

@Injectable()
export class TenantService {
  constructor(private readonly central: CentralPrismaService) {}

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
  }
}
