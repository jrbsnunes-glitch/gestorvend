/**
 * Popula banco central (tenant demo) e banco do tenant (papéis, admin, local de estoque).
 * Uso: npm run seed -w @gestorvend/api  (ou npx ts-node -r tsconfig-paths/register scripts/seed.ts)
 */
import { LicenseStatus, PrismaClient as CentralClient, TenantProvisioningStatus } from '../src/generated/central-client';
import { PrismaClient as TenantClient } from '../src/generated/tenant-client';
import { seedTenantMinimal } from '../src/provisioning/tenant-minimal-seed';

async function main() {
  const centralUrl = process.env.CENTRAL_DATABASE_URL;
  const tenantUrl = process.env.TENANT_DATABASE_URL;
  if (!centralUrl || !tenantUrl) {
    throw new Error('CENTRAL_DATABASE_URL e TENANT_DATABASE_URL são obrigatórios');
  }

  const central = new CentralClient({ datasources: { db: { url: centralUrl } } });
  const tenant = new TenantClient({ datasources: { db: { url: tenantUrl } } });

  await central.tenant.upsert({
    where: { slug: 'demo' },
    create: {
      slug: 'demo',
      cnpj: '12345678000199',
      companyName: 'Loja Demo GestorVend',
      licenseStatus: LicenseStatus.active,
      databaseName: 'gestorvend_tenant_dev',
      provisioningStatus: TenantProvisioningStatus.READY,
      provisionAdminEmail: 'admin@demo.local',
    },
    update: {
      licenseStatus: LicenseStatus.active,
      companyName: 'Loja Demo GestorVend',
      provisioningStatus: TenantProvisioningStatus.READY,
      provisionAdminEmail: 'admin@demo.local',
    },
  });

  await seedTenantMinimal(tenantUrl, {
    adminEmail: 'admin@demo.local',
    adminUsername: 'admin',
    adminPassword: 'admin123!',
    adminDisplayName: 'Administrador',
  });
  const user = await tenant.user.findUniqueOrThrow({
    where: { email: 'admin@demo.local' },
    include: { roles: true },
  });

  // eslint-disable-next-line no-console
  console.log('Seed OK. Tenant slug: demo | login: admin | senha: admin123!');
  // eslint-disable-next-line no-console
  console.log('User id:', user.id);

  await central.$disconnect();
  await tenant.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
