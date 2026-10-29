import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TenantProvisioningStatus } from '../generated/central-client';
import { CentralPrismaService } from '../prisma/central-prisma.service';
import { SalesReservationsService } from './sales-reservations.service';

@Injectable()
export class SalesReservationsProcessor {
  private readonly log = new Logger(SalesReservationsProcessor.name);
  private running = false;

  constructor(
    private readonly central: CentralPrismaService,
    private readonly reservations: SalesReservationsService,
  ) {}

  @Interval(60_000)
  async expireAllTenants(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.central.tenant.findMany({
        where: { provisioningStatus: TenantProvisioningStatus.READY },
        select: { slug: true },
      });
      for (const t of tenants) {
        try {
          await this.reservations.expireOverdueForTenant(t.slug);
        } catch (e) {
          this.log.warn(`Reserva worker tenant ${t.slug}: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
