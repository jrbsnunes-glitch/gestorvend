import { Injectable } from '@nestjs/common';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  timezoneFromBrazilUf,
} from '../common/br-uf-timezone.util';
import { defaultAppTimezone, normalizeIanaTimezone } from '../common/iana-timezone.util';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Injectable()
export class CompanyTimezoneService {
  private readonly cache = new Map<string, { tz: string; at: number }>();
  private readonly ttlMs = 60_000;

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  invalidate(tenantSlug: string): void {
    this.cache.delete(tenantSlug);
  }

  async getTimezone(tenantSlug: string): Promise<string> {
    const hit = this.cache.get(tenantSlug);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.tz;

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.company.findFirst({
      select: { timezone: true, state: true },
    });

    let tz = normalizeIanaTimezone(row?.timezone, '');
    if (!tz) {
      tz = row?.state?.trim()
        ? timezoneFromBrazilUf(row.state)
        : defaultAppTimezone() || DEFAULT_BUSINESS_TIMEZONE;
    }

    this.cache.set(tenantSlug, { tz, at: Date.now() });
    return tz;
  }
}
