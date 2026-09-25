import type { PrismaClient } from '../generated/tenant-client';

/**
 * Serializa emissões do mesmo emissor (numeração + fila) entre workers/processos no mesmo Postgres.
 */
export async function withIssuerEmitLock<T>(
  db: PrismaClient,
  issuerSettingsId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.$executeRaw`SELECT pg_advisory_lock(hashtext(${issuerSettingsId}))`;
  try {
    return await fn();
  } finally {
    try {
      await db.$executeRaw`SELECT pg_advisory_unlock(hashtext(${issuerSettingsId}))`;
    } catch {
      // unlock best-effort
    }
  }
}
