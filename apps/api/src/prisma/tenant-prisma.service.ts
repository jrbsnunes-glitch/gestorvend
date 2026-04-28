import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/tenant-client';
import { CentralPrismaService } from './central-prisma.service';

/** Pool de PrismaClient por slug de tenant (um database PostgreSQL por cliente). */
@Injectable()
export class TenantPrismaService implements OnModuleDestroy {
  private readonly clients = new Map<string, PrismaClient>();

  constructor(
    private readonly central: CentralPrismaService,
    private readonly config: ConfigService,
  ) {}

  async getClient(tenantSlug: string): Promise<PrismaClient> {
    const cached = this.clients.get(tenantSlug);
    if (cached) return cached;

    const tenant = await this.central.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      throw new NotFoundException(`Tenant não encontrado: ${tenantSlug}`);
    }

    const url = this.buildDatabaseUrl(tenant.databaseName);
    const client = new PrismaClient({
      datasources: { db: { url } },
    });
    await client.$connect();
    this.clients.set(tenantSlug, client);
    return client;
  }

  /** Troca o último segmento do path da URL JDBC (nome do database). */
  private buildDatabaseUrl(databaseName: string): string {
    const template = this.config.get<string>('TENANT_DATABASE_URL');
    if (!template) {
      throw new Error('TENANT_DATABASE_URL não configurada');
    }
    return template.replace(/\/[^/]+$/, `/${databaseName}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map((c) =>
        c.$disconnect().catch(() => undefined),
      ),
    );
    this.clients.clear();
  }
}
