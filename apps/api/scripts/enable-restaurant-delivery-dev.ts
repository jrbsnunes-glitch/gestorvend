/**
 * Ativa plano Restaurante + addon Delivery no tenant demo (dev).
 * Uso: npx ts-node -r tsconfig-paths/register scripts/enable-restaurant-delivery-dev.ts
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import {
  PlanCode,
  PrismaClient as CentralClient,
  TenantModuleAddon,
} from '../src/generated/central-client';
import { PrismaClient as TenantClient } from '../src/generated/tenant-client';

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

  const slug = (process.argv[2] ?? 'demo').trim() || 'demo';
  const central = new CentralClient();
  const t = await central.tenant.findUnique({ where: { slug } });
  if (!t) {
    throw new Error(`Tenant slug "${slug}" não encontrado no central.`);
  }

  await central.tenant.update({
    where: { id: t.id },
    data: { planCode: PlanCode.RESTAURANT },
  });
  await central.tenantModuleGrant.upsert({
    where: { tenantId_module: { tenantId: t.id, module: TenantModuleAddon.DELIVERY } },
    create: { tenantId: t.id, module: TenantModuleAddon.DELIVERY },
    update: {},
  });

  const tenant = new TenantClient({
    datasources: { db: { url: buildUrl(tenantTemplate, t.databaseName) } },
  });
  const co = await tenant.company.findFirst();
  if (co) {
    await tenant.company.update({
      where: { id: co.id },
      data: {
        restaurantModuleEnabled: true,
        deliveryEnabled: true,
        deliveryPayPickup: true,
        deliveryPayPixDeliverer: true,
      },
    });
  } else {
    await tenant.company.create({
      data: {
        legalName: t.companyName,
        tradeName: t.companyName,
        cnpj: t.cnpj,
        restaurantModuleEnabled: true,
        deliveryEnabled: true,
        deliveryPayPickup: true,
        deliveryPayPixDeliverer: true,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Restaurante + Delivery ativos: slug=${slug} db=${t.databaseName} ` +
      `plano=RESTAURANT addon=DELIVERY restaurantModuleEnabled=true deliveryEnabled=true`,
  );
  await central.$disconnect();
  await tenant.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
