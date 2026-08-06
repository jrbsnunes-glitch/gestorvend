/**
 * Importa contas referenciais (JSON) para o banco tenant.
 *
 * Uso:
 *   TENANT_DATABASE_URL=postgresql://... npx ts-node -r tsconfig-paths/register scripts/import-referential-accounts.ts [arquivo.json] [sourceVersion]
 *
 * Sem arquivo: usa o sample do repositório (grupos 4/5 necessários ao caixa).
 */
import { PrismaClient } from '../src/generated/tenant-client';
import { ensureReferentialAccountsSeeded } from '../src/provisioning/seed-referential-accounts';

async function main() {
  const url = process.env.TENANT_DATABASE_URL;
  if (!url) {
    throw new Error('TENANT_DATABASE_URL é obrigatório');
  }
  const sourceVersion = process.argv[3] ?? 'RFB-sample-v1';
  // argv[2] legado (arquivo custom) — se informado, mantém o script antigo via forceReplace do sample
  // só quando não há arquivo; arquivo custom ainda não é suportado pelo helper compartilhado.
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const n = await ensureReferentialAccountsSeeded(prisma, {
      sourceVersion,
      forceReplace: true,
    });
    // eslint-disable-next-line no-console
    console.log(`Importadas/atualizadas ${n} contas (sourceVersion=${sourceVersion})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
