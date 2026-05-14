/**
 * Seed mínimo em um banco tenant já existente e migrado.
 * Uso: TENANT_DATABASE_URL=postgresql://.../gv_tenant_x npx ts-node -r tsconfig-paths/register scripts/seed-tenant-minimal.ts admin@loja.local SenhaSegura123!
 */
import { seedTenantMinimal } from '../src/provisioning/tenant-minimal-seed';

async function main() {
  const url = process.env.TENANT_DATABASE_URL;
  if (!url) throw new Error('TENANT_DATABASE_URL é obrigatório');
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    throw new Error('Uso: seed-tenant-minimal.ts <email> <senha>');
  }
  await seedTenantMinimal(url, { adminEmail: email, adminPassword: password });
  // eslint-disable-next-line no-console
  console.log('Seed mínimo OK:', email);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
