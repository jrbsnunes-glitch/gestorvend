/**
 * Importa o plano referencial de exemplo em todos os tenants (se ainda não houver contas).
 * Uso: npm run import:referential-accounts:all -w @gestorvend/api
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { PrismaClient as CentralPrisma } from '../src/generated/central-client';
import { PrismaClient as TenantPrisma } from '../src/generated/tenant-client';
import { ensureReferentialAccountsSeeded } from '../src/provisioning/seed-referential-accounts';

function buildUrl(template: string, databaseName: string): string {
  return template.replace(/\/[^/]+$/, `/${databaseName}`);
}

function loadEnvFile(filePath: string, opts: { overwriteDbUrls?: boolean } = {}): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const isDbUrl = key === 'CENTRAL_DATABASE_URL' || key === 'TENANT_DATABASE_URL';
    if (isDbUrl && opts.overwriteDbUrls) {
      process.env[key] = value;
      continue;
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

async function main() {
  const apiRoot = path.join(__dirname, '..');
  const repoRoot = path.join(apiRoot, '..', '..');
  loadEnvFile(path.join(repoRoot, '.env'), { overwriteDbUrls: true });
  loadEnvFile(path.join(apiRoot, '.env'), { overwriteDbUrls: true });

  const force = process.argv.includes('--force');
  const centralUrl = process.env.CENTRAL_DATABASE_URL?.trim();
  const tenantTemplate = process.env.TENANT_DATABASE_URL?.trim();
  if (!centralUrl || !tenantTemplate) {
    throw new Error('CENTRAL_DATABASE_URL e TENANT_DATABASE_URL são obrigatórios.');
  }

  const central = new CentralPrisma({ datasources: { db: { url: centralUrl } } });
  try {
    const tenants = await central.tenant.findMany({
      select: { slug: true, databaseName: true },
      orderBy: { slug: 'asc' },
    });
    for (const t of tenants) {
      const url = buildUrl(tenantTemplate, t.databaseName);
      const db = new TenantPrisma({ datasources: { db: { url } } });
      try {
        const n = await ensureReferentialAccountsSeeded(db, { forceReplace: force });
        // eslint-disable-next-line no-console
        console.log(
          force
            ? `[${t.slug}] reimportado (${n} contas)`
            : n > 0
              ? `[${t.slug}] ok (${n} contas)`
              : `[${t.slug}] sem alteração`,
        );
      } finally {
        await db.$disconnect();
      }
    }
  } finally {
    await central.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
