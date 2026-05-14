import { existsSync } from 'fs';
import { join, resolve } from 'path';

const PG_IDENT_MAX = 63;

/** Nome seguro para identificador PostgreSQL (evita injeção em CREATE DATABASE). */
export function assertValidTenantDatabaseName(raw: string): string {
  const name = String(raw ?? '').trim();
  if (!name) {
    throw new Error('Nome do banco vazio.');
  }
  if (name.length > PG_IDENT_MAX) {
    throw new Error(`Nome do banco excede ${PG_IDENT_MAX} caracteres.`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(
      'Nome do banco inválido: use apenas letras minúsculas, números e underscore, começando com letra.',
    );
  }
  return name;
}

export function buildTenantDatabaseUrl(template: string, databaseName: string): string {
  return template.replace(/\/[^/]+$/, `/${databaseName}`);
}

export function adminConnectionUrlForCreateDb(adminTemplate: string): string {
  return buildTenantDatabaseUrl(adminTemplate, 'postgres');
}

/**
 * Caminho absoluto do `schema.prisma` do tenant. Em `nest start`, `__dirname` pode ser
 * `dist/provisioning` ou `dist/src/provisioning`; não assumimos profundidade fixa.
 */
export function resolveTenantPrismaSchemaPath(startDir: string = __dirname): string {
  const rel = join('prisma', 'tenant', 'schema.prisma');
  const cwdCandidates = [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), 'apps', 'api', rel),
  ];
  for (const c of cwdCandidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  let dir = resolve(startDir);
  for (let i = 0; i < 16; i++) {
    const candidate = join(dir, 'prisma', 'tenant', 'schema.prisma');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    `prisma/tenant/schema.prisma não encontrado (busca a partir de ${startDir} e cwd=${process.cwd()}).`,
  );
}

/** Raiz do pacote `@gestorvend/api` (pasta que contém `prisma/` e `node_modules/`). */
export function resolveGestorVendApiRoot(startDir: string = __dirname): string {
  const schemaPath = resolveTenantPrismaSchemaPath(startDir);
  return resolve(schemaPath, '..', '..', '..');
}
