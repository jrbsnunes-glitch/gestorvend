/**
 * Cria (ou atualiza a senha de) o primeiro SuperAdmin do portal de licenças.
 *
 * Uso:
 *   npm run bootstrap:superadmin -w @gestorvend/api
 *
 * Variáveis de ambiente:
 *   SUPERADMIN_EMAIL      (obrigatório)
 *   SUPERADMIN_PASSWORD   (obrigatório)
 *   SUPERADMIN_NAME       (opcional, default: "Super Admin")
 *   CENTRAL_DATABASE_URL  (obrigatório)
 *
 * Idempotente: se o email já existir, atualiza a senha.
 */
import * as bcrypt from 'bcrypt';
import { PrismaClient as CentralClient } from '../src/generated/central-client';

async function main() {
  const centralUrl = process.env.CENTRAL_DATABASE_URL;
  if (!centralUrl) {
    throw new Error('CENTRAL_DATABASE_URL é obrigatório.');
  }
  const email = (process.env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD ?? '';
  const name = process.env.SUPERADMIN_NAME?.trim() || 'Super Admin';
  if (!email) throw new Error('SUPERADMIN_EMAIL é obrigatório.');
  if (!password || password.length < 6) {
    throw new Error('SUPERADMIN_PASSWORD é obrigatório (mín. 6 caracteres).');
  }

  const db = new CentralClient({ datasources: { db: { url: centralUrl } } });
  const passwordHash = await bcrypt.hash(password, 10);

  await db.superAdmin.upsert({
    where: { email },
    create: { email, passwordHash, name, isActive: true },
    update: { passwordHash, name, isActive: true },
  });

  console.log(`SuperAdmin "${email}" pronto. Faça login em /portal-admin/login.`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
