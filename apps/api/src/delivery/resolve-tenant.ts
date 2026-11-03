import { NotFoundException } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';

/**
 * Resolve o tenant a partir do slug da URL (fase 1) ou do host (fase 2).
 * Não lista tenants — slug/host desconhecido vira 404 genérico.
 */
export async function resolveTenant(tenants: TenantService, slugOuHost: string): Promise<string> {
  const raw = String(slugOuHost ?? '')
    .trim()
    .toLowerCase();
  if (!raw) throw new NotFoundException();

  const slug = raw.includes('.') ? raw.split('.')[0] : raw;
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(slug)) {
    throw new NotFoundException();
  }

  try {
    const tenant = await tenants.getBySlug(slug);
    return tenant.slug;
  } catch {
    throw new NotFoundException();
  }
}
