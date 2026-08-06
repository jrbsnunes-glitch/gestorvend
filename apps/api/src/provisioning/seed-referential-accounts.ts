import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../generated/tenant-client';

const DEFAULT_SOURCE = 'RFB-sample-v1';

type Row = {
  code: string;
  description: string;
  level?: number;
  parentCode?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  taxonomyCode?: string | null;
};

function sampleFilePath(): string {
  const candidates = [
    path.join(__dirname, '../../prisma/seed-data/referential-accounts-sample.json'), // src/provisioning
    path.join(__dirname, '../../../prisma/seed-data/referential-accounts-sample.json'), // dist/src/provisioning
    path.join(process.cwd(), 'prisma/seed-data/referential-accounts-sample.json'),
    path.join(process.cwd(), 'apps/api/prisma/seed-data/referential-accounts-sample.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

export async function ensureReferentialAccountsSeeded(
  tenant: PrismaClient,
  opts?: { sourceVersion?: string; forceReplace?: boolean },
): Promise<number> {
  const sourceVersion = opts?.sourceVersion ?? DEFAULT_SOURCE;
  const existing = await tenant.referentialAccount.count({ where: { sourceVersion } });
  if (existing > 0 && !opts?.forceReplace) return existing;

  const file = sampleFilePath();
  if (!fs.existsSync(file)) {
    throw new Error(`Arquivo de plano referencial não encontrado: ${file}`);
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Row[];
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('JSON do plano referencial deve ser um array não vazio');
  }

  await tenant.$transaction(async (tx) => {
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

  return rows.length;
}
