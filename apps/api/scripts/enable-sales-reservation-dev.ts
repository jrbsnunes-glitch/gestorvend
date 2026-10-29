/**
 * Ativa addon Reserva de Vendas no ambiente local (grant no banco central).
 * Uso: npx ts-node -r tsconfig-paths/register scripts/enable-sales-reservation-dev.ts
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import {
  PrismaClient as CentralClient,
  TenantModuleAddon,
} from '../src/generated/central-client';
import { PrismaClient as TenantClient, StockLocationKind } from '../src/generated/tenant-client';

function loadEnvFile(filePath: string): void {
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
    if (isDbUrl || process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function buildUrl(template: string, databaseName: string): string {
  return template.replace(/\/[^/]+$/, `/${databaseName}`);
}

async function main() {
  const apiRoot = path.join(__dirname, '..');
  loadEnvFile(path.join(apiRoot, '../../.env'));
  loadEnvFile(path.join(apiRoot, '.env'));

  const tenantTemplate = process.env.TENANT_DATABASE_URL?.trim();
  if (!tenantTemplate) throw new Error('TENANT_DATABASE_URL é obrigatório');

  const central = new CentralClient();
  const tenants = await central.tenant.findMany({
    select: { id: true, slug: true, companyName: true, databaseName: true },
    orderBy: { slug: 'asc' },
  });
  if (!tenants.length) {
    throw new Error('Nenhum tenant no central — rode npm run seed -w @gestorvend/api');
  }

  for (const t of tenants) {
    await central.tenantModuleGrant.upsert({
      where: {
        tenantId_module: { tenantId: t.id, module: TenantModuleAddon.SALES_RESERVATION },
      },
      create: { tenantId: t.id, module: TenantModuleAddon.SALES_RESERVATION },
      update: {},
    });

    const tenant = new TenantClient({
      datasources: { db: { url: buildUrl(tenantTemplate, t.databaseName) } },
    });
    try {
      await tenant.stockLocation.upsert({
        where: { code: 'RESERVA' },
        create: {
          code: 'RESERVA',
          name: 'Reserva',
          isDefault: false,
          kind: StockLocationKind.SALES_RESERVATION,
        },
        update: { kind: StockLocationKind.SALES_RESERVATION, isDefault: false },
      });
    } finally {
      await tenant.$disconnect();
    }

    // eslint-disable-next-line no-console
    console.log(`SALES_RESERVATION ativo: slug=${t.slug} (${t.companyName})`);
  }

  await central.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
