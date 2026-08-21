require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { PrismaClient, TenantModuleAddon } = require('../src/generated/central-client');
const { PrismaClient: TenantPrisma } = require('../src/generated/tenant-client');

function buildTenantDatabaseUrl(template, databaseName) {
  const u = new URL(template);
  u.pathname = `/${databaseName}`;
  return u.toString();
}

async function main() {
  const central = new PrismaClient();
  try {
    const t = await central.tenant.findUnique({
      where: { slug: 'demo' },
      include: { moduleGrants: true },
    });
    if (!t) {
      console.error('Tenant demo não encontrado');
      process.exit(1);
    }
    console.log(
      'Central antes:',
      t.slug,
      t.databaseName,
      t.moduleGrants.map((g) => g.module),
    );

    await central.tenantModuleGrant.upsert({
      where: {
        tenantId_module: {
          tenantId: t.id,
          module: TenantModuleAddon.SERVICE_ORDER,
        },
      },
      create: { tenantId: t.id, module: TenantModuleAddon.SERVICE_ORDER },
      update: {},
    });

    const grants = await central.tenantModuleGrant.findMany({
      where: { tenantId: t.id },
    });
    console.log(
      'Central depois:',
      grants.map((g) => g.module),
    );

    const template = process.env.TENANT_DATABASE_URL;
    if (!template) {
      console.error('TENANT_DATABASE_URL ausente');
      process.exit(1);
    }
    const url = buildTenantDatabaseUrl(template, t.databaseName);
    const tenant = new TenantPrisma({ datasources: { db: { url } } });
    try {
      const company = await tenant.company.findFirst();
      if (!company) {
        console.error('Company do demo não encontrada');
        process.exit(1);
      }
      const updated = await tenant.company.update({
        where: { id: company.id },
        data: { serviceOrderModuleEnabled: true },
      });
      console.log(
        'Empresa demo serviceOrderModuleEnabled =',
        updated.serviceOrderModuleEnabled,
      );
    } finally {
      await tenant['$disconnect']();
    }
  } finally {
    await central['$disconnect']();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
