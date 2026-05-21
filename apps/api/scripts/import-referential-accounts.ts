/**
 * Importa contas referenciais (JSON) para o banco tenant.
 *
 * Uso:
 *   TENANT_DATABASE_URL=postgresql://... npx ts-node -r tsconfig-paths/register scripts/import-referential-accounts.ts <arquivo.json> [sourceVersion]
 *
 * O arquivo deve ser um array de objetos: code, description, level?, parentCode?, validFrom?, validTo?, taxonomyCode?
 *
 * Substitua o arquivo de exemplo pelo layout oficial da RFB quando disponível.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../src/generated/tenant-client';

type Row = {
  code: string;
  description: string;
  level?: number;
  parentCode?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  taxonomyCode?: string | null;
};

async function main() {
  const url = process.env.TENANT_DATABASE_URL;
  const fileArg = process.argv[2];
  const sourceVersion = process.argv[3] ?? 'RFB-sample-v1';
  if (!url) {
    throw new Error('TENANT_DATABASE_URL é obrigatório');
  }
  const file = fileArg
    ? path.resolve(process.cwd(), fileArg)
    : path.join(__dirname, '../prisma/seed-data/referential-accounts-sample.json');
  if (!fs.existsSync(file)) {
    throw new Error(`Arquivo não encontrado: ${file}`);
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Row[];
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('JSON deve ser um array não vazio');
  }

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.referentialAccount.deleteMany({ where: { sourceVersion } });
      for (const r of rows) {
        if (!r.code?.trim() || !r.description?.trim()) continue;
        await tx.referentialAccount.create({
          data: {
            code: r.code.trim(),
            description: r.description.trim(),
            level: r.level ?? 1,
            parentCode: r.parentCode?.trim() || null,
            validFrom: r.validFrom ? new Date(r.validFrom) : null,
            validTo: r.validTo ? new Date(r.validTo) : null,
            taxonomyCode: r.taxonomyCode?.trim() || null,
            sourceVersion,
          },
        });
      }
    });
    // eslint-disable-next-line no-console
    console.log(`Importadas ${rows.length} contas (sourceVersion=${sourceVersion})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
