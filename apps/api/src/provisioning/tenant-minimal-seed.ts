import * as bcrypt from 'bcrypt';
import { PrismaClient } from '../generated/tenant-client';

export type TenantMinimalSeedOptions = {
  adminEmail: string;
  adminPassword: string;
  adminDisplayName?: string;
};

/**
 * Papéis, usuário admin, local padrão e config fiscal placeholder — idempotente (upserts).
 */
export async function seedTenantMinimal(
  tenantUrl: string,
  opts: TenantMinimalSeedOptions,
): Promise<void> {
  const tenant = new PrismaClient({ datasources: { db: { url: tenantUrl } } });
  try {
    const roles = ['admin', 'manager', 'seller', 'finance'] as const;
    for (const name of roles) {
      await tenant.role.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    }

    const adminRole = await tenant.role.findUniqueOrThrow({ where: { name: 'admin' } });
    const hash = await bcrypt.hash(opts.adminPassword, 10);
    const email = opts.adminEmail.trim().toLowerCase();
    await tenant.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash: hash,
        name: opts.adminDisplayName?.trim() || 'Administrador',
        roles: { connect: { id: adminRole.id } },
      },
      update: {
        passwordHash: hash,
        name: opts.adminDisplayName?.trim() || 'Administrador',
        roles: { set: [{ id: adminRole.id }] },
      },
    });

    await tenant.stockLocation.upsert({
      where: { code: 'MATRIZ' },
      create: { code: 'MATRIZ', name: 'Matriz', isDefault: true },
      update: { isDefault: true },
    });

    const fc = await tenant.fiscalConfig.findFirst();
    if (!fc) {
      await tenant.fiscalConfig.create({
        data: { regime: 'SIMPLES', notes: 'Placeholder Etapa 2' },
      });
    }
  } finally {
    await tenant.$disconnect();
  }
}
