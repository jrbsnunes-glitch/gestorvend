/**
 * Popula banco central (tenant demo) e banco do tenant (papéis, admin, local de estoque).
 * Uso: npm run seed -w @gestorvend/api  (ou npx ts-node -r tsconfig-paths/register scripts/seed.ts)
 */
import * as bcrypt from 'bcrypt';
import { LicenseStatus, PrismaClient as CentralClient } from '../src/generated/central-client';
import { PrismaClient as TenantClient } from '../src/generated/tenant-client';

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
    },
    update: {
      licenseStatus: LicenseStatus.active,
      companyName: 'Loja Demo GestorVend',
    },
  });

  const roles = ['admin', 'manager', 'seller', 'finance'] as const;
  for (const name of roles) {
    await tenant.role.upsert({
      where: { name },
      create: { name },
      update: {},
    });
  }

  const adminRole = await tenant.role.findUniqueOrThrow({ where: { name: 'admin' } });
  const hash = await bcrypt.hash('Admin123!', 10);
  const user = await tenant.user.upsert({
    where: { email: 'admin@demo.local' },
    create: {
      email: 'admin@demo.local',
      passwordHash: hash,
      name: 'Administrador',
      roles: { connect: { id: adminRole.id } },
    },
    update: {
      passwordHash: hash,
      roles: { set: [{ id: adminRole.id }] },
    },
    include: { roles: true },
  });

  await tenant.stockLocation.upsert({
    where: { code: 'MATRIZ' },
    create: { code: 'MATRIZ', name: 'Matriz', isDefault: true },
    update: { isDefault: true },
  });

  const fc = await tenant.fiscalConfig.findFirst();
  if (!fc) {
    await tenant.fiscalConfig.create({
      data: { regime: 'SIMPLES', notes: 'Placeholder Etapa 2' },
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seed OK. Tenant slug: demo | login: admin@demo.local | senha: Admin123!');
  // eslint-disable-next-line no-console
  console.log('User id:', user.id);

  await central.$disconnect();
  await tenant.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
