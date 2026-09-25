/**
 * Ativa addon Fábrica no tenant demo (dev) — grant central + flag na empresa.
 * Uso: npx ts-node -r tsconfig-paths/register scripts/enable-factory-dev.ts
 */
import {
  PrismaClient as CentralClient,
  TenantModuleAddon,
} from '../src/generated/central-client';
import { PrismaClient as TenantClient } from '../src/generated/tenant-client';

async function main() {
  const tenantUrl = process.env.TENANT_DATABASE_URL;
  if (!tenantUrl) throw new Error('TENANT_DATABASE_URL é obrigatório');

  const central = new CentralClient();
  const tenant = new TenantClient({ datasources: { db: { url: tenantUrl } } });

  const t = await central.tenant.findUnique({ where: { slug: 'demo' } });
  if (!t) {
    throw new Error('Tenant slug "demo" não encontrado no central — rode npm run seed -w @gestorvend/api');
  }

  await central.tenantModuleGrant.upsert({
    where: { tenantId_module: { tenantId: t.id, module: TenantModuleAddon.FACTORY } },
    create: { tenantId: t.id, module: TenantModuleAddon.FACTORY },
    update: {},
  });

  const co = await tenant.company.findFirst();
  if (co) {
    await tenant.company.update({
      where: { id: co.id },
      data: { factoryModuleEnabled: true },
    });
  } else {
    await tenant.company.create({
      data: {
        legalName: t.companyName,
        tradeName: t.companyName,
        cnpj: t.cnpj,
        factoryModuleEnabled: true,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('Fábrica ativada: slug=demo | FACTORY no portal (central) | factoryModuleEnabled=true');
  await central.$disconnect();
  await tenant.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
