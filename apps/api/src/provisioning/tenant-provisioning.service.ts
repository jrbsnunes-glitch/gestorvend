import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import {
  TenantProvisioningStatus,
} from '../generated/central-client';
import { CentralPrismaService } from '../prisma/central-prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  adminConnectionUrlForCreateDb,
  assertValidTenantDatabaseName,
  buildTenantDatabaseUrl,
  resolveGestorVendApiRoot,
  resolveTenantPrismaSchemaPath,
} from './tenant-database-name';
import { seedTenantMinimal } from './tenant-minimal-seed';

export type TenantProvisionSeed = {
  adminEmail: string;
  adminPassword: string;
  adminUsername?: string;
};

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly central: CentralPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /**
   * Dispara provisionamento fora da thread HTTP (sem Bull no MVP).
   * Recomendado fila + worker quando houver muitos tenants ou SLAs rígidos.
   */
  scheduleProvision(tenantId: string, seed: TenantProvisionSeed): void {
    setImmediate(() => {
      void this.runProvision(tenantId, seed).catch((err) => {
        this.logger.error(
          `Provisionamento não tratado para tenant ${tenantId}: ${(err as Error).message}`,
        );
      });
    });
  }

  private getAdminTemplateUrl(): string {
    const admin = this.config.get<string>('TENANT_ADMIN_DATABASE_URL');
    const fallback = this.config.get<string>('TENANT_DATABASE_URL');
    const url = admin?.trim() || fallback;
    if (!url) {
      throw new Error('Configure TENANT_ADMIN_DATABASE_URL ou TENANT_DATABASE_URL.');
    }
    return url;
  }

  private getTenantTemplateUrl(): string {
    const url = this.config.get<string>('TENANT_DATABASE_URL');
    if (!url) {
      throw new Error('TENANT_DATABASE_URL não configurada.');
    }
    return url;
  }

  async runProvision(tenantId: string, seed: TenantProvisionSeed): Promise<void> {
    const attempt = await this.central.tenant.updateMany({
      where: {
        id: tenantId,
        provisioningStatus: {
          in: [TenantProvisioningStatus.PENDING, TenantProvisioningStatus.FAILED],
        },
      },
      data: {
        provisioningStatus: TenantProvisioningStatus.PROVISIONING,
        provisioningError: null,
        provisioningUpdatedAt: new Date(),
      },
    });
    if (attempt.count === 0) {
      const row = await this.central.tenant.findUnique({ where: { id: tenantId } });
      this.logger.debug(
        `Provisionamento ignorado (${row?.provisioningStatus ?? 'desconhecido'}): ${tenantId}`,
      );
      return;
    }

    const tenant = await this.central.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return;
    }

    let databaseName: string;
    try {
      databaseName = assertValidTenantDatabaseName(tenant.databaseName);
    } catch (e) {
      await this.markFailed(tenantId, (e as Error).message);
      return;
    }

    const adminTemplate = this.getAdminTemplateUrl();
    const tenantTemplate = this.getTenantTemplateUrl();
    const adminUrl = adminConnectionUrlForCreateDb(adminTemplate);
    const tenantUrl = buildTenantDatabaseUrl(tenantTemplate, databaseName);

    try {
      await this.ensureDatabaseExists(adminUrl, databaseName);
      try {
        this.runMigrateDeploy(tenantUrl);
      } catch (migrateErr) {
        const msg = this.stripCliArtifacts((migrateErr as Error).message || String(migrateErr));
        if (this.isPrismaFailedHistoryError(msg)) {
          this.logger.warn(
            `Migrações bloqueadas (Prisma); recriando banco ${databaseName} e repetindo deploy.`,
          );
          await this.dropAndRecreateDatabase(adminUrl, databaseName);
          this.runMigrateDeploy(tenantUrl);
        } else {
          throw migrateErr;
        }
      }
      await seedTenantMinimal(tenantUrl, {
        adminEmail: seed.adminEmail,
        adminPassword: seed.adminPassword,
        adminUsername: seed.adminUsername,
      });
      await this.central.tenant.update({
        where: { id: tenantId },
        data: {
          provisioningStatus: TenantProvisioningStatus.READY,
          provisioningError: null,
          provisioningUpdatedAt: new Date(),
        },
      });
      this.tenantPrisma.invalidateClient(tenant.slug);
      this.logger.log(`Tenant provisionado: ${tenant.slug} -> ${databaseName}`);
    } catch (err) {
      const message = this.stripCliArtifacts((err as Error).message || String(err));
      await this.markFailed(tenantId, message);
      this.logger.warn(`Falha ao provisionar ${tenant.slug}: ${message}`);
    }
  }

  private async markFailed(tenantId: string, message: string): Promise<void> {
    await this.central.tenant.update({
      where: { id: tenantId },
      data: {
        provisioningStatus: TenantProvisioningStatus.FAILED,
        provisioningError: this.stripCliArtifacts(message).slice(0, 4000),
        provisioningUpdatedAt: new Date(),
      },
    });
  }

  private async ensureDatabaseExists(adminUrl: string, databaseName: string): Promise<void> {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      const q = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
      if (q.rowCount) {
        return;
      }
      await client.query(`CREATE DATABASE ${databaseName}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  /** Remove códigos de cor do terminal (ex.: `[31m`) que poluíam a mensagem no portal. */
  private stripCliArtifacts(text: string): string {
    return String(text)
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/\[\d+m/g, '')
      .replace(/\[\d+;\d+m/g, '')
      .replace(/\r/g, '')
      .trim();
  }

  /**
   * Códigos comuns em que o histórico em `_prisma_migrations` ou o estado do banco
   * impede novo `deploy`. P3015 costuma indicar divergência arquivo↔histórico.
   * Em provisionamento (tenant ainda não READY), recriar o database costuma destravar.
   */
  private isPrismaFailedHistoryError(message: string): boolean {
    const raw = this.stripCliArtifacts(message);
    const m = raw.toLowerCase();
    if (/\bp3009\b/.test(m) || /\bp3015\b/.test(m) || /\bp3016\b/.test(m) || /\bp3017\b/.test(m) || /\bp3018\b/.test(m)) {
      return true;
    }
    return (
      m.includes('found failed migrations') ||
      m.includes('failed migrations in the target database') ||
      m.includes('migration failed to apply') ||
      m.includes('could not find the migration file') ||
      m.includes('before the error is recovered')
    );
  }

  /** Encerra sessões, remove o database e cria de novo (nome já validado). */
  private async dropAndRecreateDatabase(adminUrl: string, databaseName: string): Promise<void> {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        databaseName,
      ]);
      if (!exists.rowCount) {
        await client.query(`CREATE DATABASE ${databaseName}`);
        return;
      }
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await client.query(`DROP DATABASE ${databaseName}`);
      await client.query(`CREATE DATABASE ${databaseName}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private runMigrateDeploy(tenantUrl: string): void {
    const schemaPath = resolveTenantPrismaSchemaPath();
    const apiRoot = resolveGestorVendApiRoot();
    let prismaCli: string;
    try {
      prismaCli = createRequire(join(apiRoot, 'package.json')).resolve('prisma/build/index.js');
    } catch {
      throw new Error(
        `Pacote prisma não encontrado a partir de ${apiRoot} (instale dependências na raiz do workspace).`,
      );
    }
    if (!existsSync(prismaCli)) {
      throw new Error(`Prisma CLI ausente em ${prismaCli}`);
    }
    try {
      execFileSync(
        process.execPath,
        [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
        {
          cwd: apiRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
          env: { ...process.env, TENANT_DATABASE_URL: tenantUrl },
        },
      );
    } catch (e) {
      const err = e as Error & { stdout?: string; stderr?: string };
      const detail = this.stripCliArtifacts(
        [err.stderr, err.stdout].filter(Boolean).join('\n').trim(),
      );
      const base = this.stripCliArtifacts(err.message || '');
      throw new Error(detail || base || 'prisma migrate deploy falhou');
    }
  }
}
