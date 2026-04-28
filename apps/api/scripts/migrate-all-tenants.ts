/**
 * Aplica `prisma migrate deploy` no schema de tenant para cada registro em `Tenant.databaseName`.
 * Requer CENTRAL_DATABASE_URL e TENANT_DATABASE_URL base (mesmo host/credenciais; só troca o nome do DB).
 */
import { execSync } from 'child_process';
import { PrismaClient } from '../src/generated/central-client';
import * as path from 'path';

function buildUrl(template: string, databaseName: string): string {
  return template.replace(/\/[^/]+$/, `/${databaseName}`);
}

async function main() {
  const centralUrl = process.env.CENTRAL_DATABASE_URL;
  const tenantTemplate = process.env.TENANT_DATABASE_URL;
  if (!centralUrl || !tenantTemplate) {
    throw new Error('CENTRAL_DATABASE_URL e TENANT_DATABASE_URL são obrigatórios');
  }

  const central = new PrismaClient({ datasources: { db: { url: centralUrl } } });
  const tenants = await central.tenant.findMany();
  await central.$disconnect();

  const schemaPath = path.join(__dirname, '../prisma/tenant/schema.prisma');
  for (const t of tenants) {
    const url = buildUrl(tenantTemplate, t.databaseName);
    // eslint-disable-next-line no-console
    console.log(`Migrando tenant ${t.slug} -> ${t.databaseName}`);
    execSync(`npx prisma migrate deploy --schema "${schemaPath}"`, {
      stdio: 'inherit',
      env: { ...process.env, TENANT_DATABASE_URL: url },
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
