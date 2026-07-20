/**
 * Aplica `prisma migrate deploy` no schema de tenant para cada registro em `Tenant.databaseName`.
 * Requer CENTRAL_DATABASE_URL e TENANT_DATABASE_URL base (mesmo host/credenciais; só troca o nome do DB).
 *
 * Carrega `.env` da raiz do monorepo e de `apps/api` sem expansão bash (evita corromper senhas com `$`).
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { PrismaClient } from '../src/generated/central-client';

function buildUrl(template: string, databaseName: string): string {
  return template.replace(/\/[^/]+$/, `/${databaseName}`);
}

/** Lê KEY=VALUE de um .env sem interpretar `$` (diferente do `source` do bash). */
function loadEnvFile(
  filePath: string,
  opts: { overwriteDbUrls?: boolean } = {},
): void {
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
    // Não sobrescreve outras variáveis já exportadas no shell.
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function resolveApiRoot(): string {
  // scripts/ → apps/api
  return path.join(__dirname, '..');
}

function resolveMonorepoRoot(apiRoot: string): string {
  return path.join(apiRoot, '..', '..');
}

function maskDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(URL inválida)';
  }
}

async function main() {
  const apiRoot = resolveApiRoot();
  const repoRoot = resolveMonorepoRoot(apiRoot);

  // Ordem: raiz, depois apps/api. URLs de banco sempre vêm do arquivo
  // (evita senha corrompida por `source .env` com `$` no hex).
  loadEnvFile(path.join(repoRoot, '.env'), { overwriteDbUrls: true });
  loadEnvFile(path.join(apiRoot, '.env'), { overwriteDbUrls: true });

  const centralUrl = process.env.CENTRAL_DATABASE_URL?.trim();
  const tenantTemplate = process.env.TENANT_DATABASE_URL?.trim();
  if (!centralUrl || !tenantTemplate) {
    throw new Error(
      'CENTRAL_DATABASE_URL e TENANT_DATABASE_URL são obrigatórios. ' +
        'Defina no .env da raiz ou de apps/api (sem $ na frente da senha hex).',
    );
  }

  // eslint-disable-next-line no-console
  console.log('Central:', maskDatabaseUrl(centralUrl));
  // eslint-disable-next-line no-console
  console.log('Tenant template:', maskDatabaseUrl(tenantTemplate));

  const central = new PrismaClient({ datasources: { db: { url: centralUrl } } });
  const tenants = await central.tenant.findMany();
  await central.$disconnect();

  if (!tenants.length) {
    // eslint-disable-next-line no-console
    console.log('Nenhum tenant no catálogo central.');
    return;
  }

  const schemaPath = path.join(apiRoot, 'prisma', 'tenant', 'schema.prisma');
  for (const t of tenants) {
    const url = buildUrl(tenantTemplate, t.databaseName);
    // eslint-disable-next-line no-console
    console.log(`Migrando tenant ${t.slug} -> ${t.databaseName}`);
    execSync(`npx prisma migrate deploy --schema "${schemaPath}"`, {
      stdio: 'inherit',
      cwd: apiRoot,
      env: { ...process.env, TENANT_DATABASE_URL: url },
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
