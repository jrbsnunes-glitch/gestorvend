/**
 * Registra um novo tenant no banco central.
 * A criação física do database PostgreSQL deve existir antes (ou use superusuário em script separado).
 *
 * Exemplo:
 *   TENANT_DATABASE_URL=postgresql://.../template npx ts-node scripts/provision-tenant.ts demo 12345678000199 "Minha Loja" gv_tenant_demo
 */
import { LicenseStatus, PrismaClient } from '../src/generated/central-client';

async function main() {
  const [slug, cnpj, companyName, databaseName] = process.argv.slice(2);
  if (!slug || !cnpj || !companyName || !databaseName) {
    throw new Error(
      'Uso: provision-tenant.ts <slug> <cnpj> <companyName> <databaseName>',
    );
  }
  const url = process.env.CENTRAL_DATABASE_URL;
  if (!url) throw new Error('CENTRAL_DATABASE_URL é obrigatório');

  const central = new PrismaClient({ datasources: { db: { url } } });
  const row = await central.tenant.create({
    data: {
      slug,
      cnpj,
      companyName,
      databaseName,
      licenseStatus: LicenseStatus.trial,
    },
  });
  await central.$disconnect();
  // eslint-disable-next-line no-console
  console.log('Tenant registrado:', row);
  // eslint-disable-next-line no-console
  console.log(
    'Crie o database no PostgreSQL se ainda não existir: CREATE DATABASE "' + databaseName + '";',
  );
  // eslint-disable-next-line no-console
  console.log('Depois rode: npm run tenant:migrate-all -w @gestorvend/api');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
