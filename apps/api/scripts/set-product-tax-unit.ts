/**
 * Define a unidade tributável (`Product.taxUnit`) de todos os produtos de um tenant.
 * O valor gravado é o **código** cadastrado em `TaxUnitCode` (ex.: `UN`), não a descrição.
 *
 * Uso:
 *   npm run tenant:set-tax-unit -w @gestorvend/api -- --slug jdn
 *   npm run tenant:set-tax-unit -w @gestorvend/api -- --slug jdn --code UN
 *   npm run tenant:set-tax-unit -w @gestorvend/api -- --slug jdn --dry-run
 *
 * Variáveis: CENTRAL_DATABASE_URL, TENANT_DATABASE_URL (modelo; troca só o nome do DB).
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { PrismaClient as CentralClient } from '../src/generated/central-client';
import { PrismaClient as TenantClient } from '../src/generated/tenant-client';
import { buildTenantDatabaseUrl } from '../src/provisioning/tenant-database-name';

function loadEnvFile(filePath: string, opts: { overwriteDbUrls?: boolean } = {}): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const isDbUrl = key === 'CENTRAL_DATABASE_URL' || key === 'TENANT_DATABASE_URL';
    if (isDbUrl && opts.overwriteDbUrls) {
      process.env[key] = value;
      continue;
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = { code: 'UN' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith('--')) {
        out[key] = val;
        i++;
      }
    }
  }
  return out;
}

async function main() {
  const apiRoot = path.join(__dirname, '..');
  const repoRoot = path.join(apiRoot, '..', '..');
  loadEnvFile(path.join(repoRoot, '.env'), { overwriteDbUrls: true });
  loadEnvFile(path.join(apiRoot, '.env'), { overwriteDbUrls: true });

  const args = parseArgs(process.argv.slice(2));
  const slug = String(args.slug ?? '').trim();
  const code = String(args.code ?? 'UN')
    .trim()
    .toUpperCase()
    .slice(0, 10);
  const dryRun = args.dryRun === true;

  if (!slug) {
    throw new Error('Informe --slug (ex.: --slug jdn).');
  }
  if (!code) {
    throw new Error('Informe --code válido (ex.: --code UN).');
  }

  const centralUrl = process.env.CENTRAL_DATABASE_URL?.trim();
  const tenantTemplate = process.env.TENANT_DATABASE_URL?.trim();
  if (!centralUrl || !tenantTemplate) {
    throw new Error('CENTRAL_DATABASE_URL e TENANT_DATABASE_URL são obrigatórios no .env.');
  }

  const central = new CentralClient({ datasources: { db: { url: centralUrl } } });
  const tenant = await central.tenant.findUnique({ where: { slug } });
  await central.$disconnect();

  if (!tenant) {
    throw new Error(`Tenant não encontrado: slug "${slug}".`);
  }

  const tenantUrl = buildTenantDatabaseUrl(tenantTemplate, tenant.databaseName);
  const db = new TenantClient({ datasources: { db: { url: tenantUrl } } });

  const unit = await db.taxUnitCode.findUnique({ where: { code } });
  if (!unit) {
    await db.$disconnect();
    throw new Error(
      `Código "${code}" não existe em TaxUnitCode neste tenant. Cadastre em Cadastros gerais ou via API antes.`,
    );
  }

  const total = await db.product.count();
  const toUpdate = await db.product.count({
    where: {
      OR: [{ taxUnit: null }, { taxUnit: { not: code } }],
    },
  });
  const already = total - toUpdate;

  // eslint-disable-next-line no-console
  console.log(`Tenant: ${tenant.slug} (${tenant.databaseName})`);
  // eslint-disable-next-line no-console
  console.log(`Unidade: ${unit.code} — ${unit.description}`);
  // eslint-disable-next-line no-console
  console.log(`Produtos: ${total} total · ${already} já com "${code}" · ${toUpdate} a atualizar`);

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('Dry-run: nenhuma alteração gravada.');
    await db.$disconnect();
    return;
  }

  if (toUpdate === 0) {
    // eslint-disable-next-line no-console
    console.log('Nada a fazer.');
    await db.$disconnect();
    return;
  }

  const result = await db.product.updateMany({
    where: {
      OR: [{ taxUnit: null }, { taxUnit: { not: code } }],
    },
    data: { taxUnit: code },
  });

  await db.$disconnect();

  // eslint-disable-next-line no-console
  console.log(`Atualizados: ${result.count} produto(s) com taxUnit="${code}".`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
