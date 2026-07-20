/**
 * Redefine a senha do administrador de um tenant e grava arquivo de configuração
 * (slug, banco, URL de conexão, credenciais) para operações de migração/atualização.
 *
 * Uso (a partir de apps/api ou raiz do monorepo, com .env carregado):
 *
 *   npm run tenant:reset-admin -w @gestorvend/api -- --slug demo
 *   npm run tenant:reset-admin -w @gestorvend/api -- --cnpj 12345678000199 --migrate
 *   npm run tenant:reset-admin -w @gestorvend/api -- --slug acme --email admin@loja.com
 *   npm run tenant:reset-admin -w @gestorvend/api -- --export-all
 *   npm run tenant:reset-admin -w @gestorvend/api -- --slug demo --export-only
 *
 * Variáveis: CENTRAL_DATABASE_URL, TENANT_DATABASE_URL (modelo; só troca o nome do DB).
 *
 * O arquivo gerado fica em data/tenant-configs/<slug>.json (ou --output).
 * Senha gerada: equivalente a `openssl rand -hex 16` (32 caracteres hex).
 * Contém senha em texto — restrinja permissões (chmod 600) e não commite no Git.
 */
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { PrismaClient as CentralClient } from '../src/generated/central-client';
import {
  buildTenantDatabaseUrl,
  resolveTenantPrismaSchemaPath,
} from '../src/provisioning/tenant-database-name';
import { seedTenantMinimal } from '../src/provisioning/tenant-minimal-seed';

type TenantRow = Awaited<ReturnType<CentralClient['tenant']['findFirst']>>;

type TenantConfigFile = {
  version: 1;
  generatedAt: string;
  slug: string;
  cnpj: string;
  companyName: string;
  databaseName: string;
  tenantDatabaseUrl: string;
  adminEmail: string;
  adminPassword?: string;
  licenseStatus: string;
  provisioningStatus: string;
  migrate: {
    schemaPath: string;
    command: string;
    migrateAllHint: string;
  };
  login: {
    tenantSlug: string;
    adminEmail: string;
    note: string;
  };
};

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--migrate') out.migrate = true;
    else if (a === '--export-all') out.exportAll = true;
    else if (a === '--export-only') out.exportOnly = true;
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

function onlyDigits(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

/** Mesmo formato de `openssl rand -hex 16` (16 bytes → 32 chars hex). */
function generateStrongPassword(): string {
  return randomBytes(16).toString('hex');
}

function defaultAdminEmail(slug: string): string {
  return `admin.${slug.replace(/-/g, '_')}@gestorvend.local`;
}

function resolveOutputPath(slug: string, explicit?: string): string {
  if (explicit) return resolve(explicit);
  const apiRoot = process.cwd().endsWith('api')
    ? process.cwd()
    : resolve(process.cwd(), 'apps', 'api');
  return join(apiRoot, 'data', 'tenant-configs', `${slug}.json`);
}

function buildConfig(
  tenant: NonNullable<TenantRow>,
  tenantUrl: string,
  adminEmail: string,
  adminPassword: string | undefined,
  schemaPath: string,
): TenantConfigFile {
  const migrateCmd =
    `TENANT_DATABASE_URL="${tenantUrl}" npx prisma migrate deploy --schema "${schemaPath}"`;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    slug: tenant.slug,
    cnpj: tenant.cnpj,
    companyName: tenant.companyName,
    databaseName: tenant.databaseName,
    tenantDatabaseUrl: tenantUrl,
    adminEmail,
    ...(adminPassword ? { adminPassword } : {}),
    licenseStatus: tenant.licenseStatus,
    provisioningStatus: tenant.provisioningStatus,
    migrate: {
      schemaPath,
      command: migrateCmd,
      migrateAllHint: 'npm run tenant:migrate-all -w @gestorvend/api',
    },
    login: {
      tenantSlug: tenant.slug,
      adminEmail,
      note: 'Use o slug como tenant no login da aplica web.',
    },
  };
}

function writeConfigFile(path: string, config: TenantConfigFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function runMigrate(tenantUrl: string, schemaPath: string): void {
  // eslint-disable-next-line no-console
  console.log('Aplicando migrações no tenant…');
  execSync(`npx prisma migrate deploy --schema "${schemaPath}"`, {
    stdio: 'inherit',
    env: { ...process.env, TENANT_DATABASE_URL: tenantUrl },
  });
}

async function findTenant(
  central: CentralClient,
  slug?: string,
  cnpj?: string,
): Promise<NonNullable<TenantRow>> {
  if (slug) {
    const row = await central.tenant.findUnique({ where: { slug } });
    if (!row) throw new Error(`Tenant não encontrado: slug "${slug}".`);
    return row;
  }
  if (cnpj) {
    const digits = onlyDigits(cnpj);
    if (digits.length !== 14) throw new Error('CNPJ deve ter 14 dígitos.');
    const row = await central.tenant.findUnique({ where: { cnpj: digits } });
    if (!row) throw new Error(`Tenant não encontrado: CNPJ ${digits}.`);
    return row;
  }
  throw new Error('Informe --slug ou --cnpj.');
}

async function processTenant(
  central: CentralClient,
  tenant: NonNullable<TenantRow>,
  opts: {
    email?: string;
    password?: string;
    output?: string;
    migrate?: boolean;
    exportOnly?: boolean;
  },
): Promise<TenantConfigFile> {
  const template = process.env.TENANT_DATABASE_URL?.trim();
  if (!template) {
    throw new Error('TENANT_DATABASE_URL não configurada.');
  }
  const tenantUrl = buildTenantDatabaseUrl(template, tenant.databaseName);
  const schemaPath = resolveTenantPrismaSchemaPath(__dirname);

  const adminEmail = (
    opts.email?.trim() ||
    tenant.provisionAdminEmail ||
    defaultAdminEmail(tenant.slug)
  ).toLowerCase();

  let adminPassword: string | undefined;

  if (!opts.exportOnly) {
    adminPassword = opts.password?.trim() || generateStrongPassword();
    if (opts.migrate) {
      runMigrate(tenantUrl, schemaPath);
    }
    await seedTenantMinimal(tenantUrl, {
      adminEmail,
      adminPassword,
      adminDisplayName: 'Administrador',
    });
    await central.tenant.update({
      where: { id: tenant.id },
      data: { provisionAdminEmail: adminEmail },
    });
    // eslint-disable-next-line no-console
    console.log(`Senha do admin redefinida: ${adminEmail}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`Exportação apenas (sem alterar senha): ${tenant.slug}`);
  }

  const config = buildConfig(tenant, tenantUrl, adminEmail, adminPassword, schemaPath);
  const outPath = resolveOutputPath(tenant.slug, opts.output);
  writeConfigFile(outPath, config);
  // eslint-disable-next-line no-console
  console.log(`Configuração gravada: ${outPath}`);
  if (adminPassword) {
    // eslint-disable-next-line no-console
    console.log(`Senha gerada (também no JSON): ${adminPassword}`);
  }
  return config;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const centralUrl = process.env.CENTRAL_DATABASE_URL?.trim();
  if (!centralUrl) {
    throw new Error('CENTRAL_DATABASE_URL é obrigatório.');
  }

  const central = new CentralClient({ datasources: { db: { url: centralUrl } } });

  try {
    if (args.exportAll) {
      const tenants = await central.tenant.findMany({ orderBy: { slug: 'asc' } });
      const template = process.env.TENANT_DATABASE_URL?.trim();
      if (!template) throw new Error('TENANT_DATABASE_URL não configurada.');
      const schemaPath = resolveTenantPrismaSchemaPath(__dirname);
      const apiRoot = process.cwd().endsWith('api')
        ? process.cwd()
        : resolve(process.cwd(), 'apps', 'api');
      const manifestPath = join(apiRoot, 'data', 'tenant-configs', 'manifest.json');
      const entries = tenants.map((t) => {
        const tenantUrl = buildTenantDatabaseUrl(template, t.databaseName);
        const adminEmail = t.provisionAdminEmail || defaultAdminEmail(t.slug);
        return buildConfig(t, tenantUrl, adminEmail, undefined, schemaPath);
      });
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), tenants: entries }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      for (const t of tenants) {
        const cfg = entries.find((e) => e.slug === t.slug)!;
        writeConfigFile(resolveOutputPath(t.slug), cfg);
      }
      // eslint-disable-next-line no-console
      console.log(`Manifesto: ${manifestPath} (${tenants.length} tenant(s))`);
      return;
    }

    const tenant = await findTenant(
      central,
      args.slug as string | undefined,
      args.cnpj as string | undefined,
    );

    await processTenant(central, tenant, {
      email: args.email as string | undefined,
      password: args.password as string | undefined,
      output: args.output as string | undefined,
      migrate: Boolean(args.migrate),
      exportOnly: Boolean(args.exportOnly),
    });
  } finally {
    await central.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
