import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanCode } from '../../generated/central-client';
import { TenantService } from '../../tenant/tenant.service';
import { PLAN_KEY } from '../plan.decorator';
import { JwtPayload } from '../strategies/jwt.strategy';

/**
 * Valida que o tenant do usuário (ou recebido na request) está em um plano permitido.
 *
 * Resolução do slug do tenant, em ordem:
 *  1. `req.user.tenantSlug` (rotas autenticadas por JWT).
 *  2. `req.tenantSlug` (rotas bridge sem JWT que já foram autenticadas via API key,
 *     responsáveis por setar essa propriedade).
 *  3. Query string `?tenantSlug=...` ou body `{ tenantSlug }` (fallback).
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenants: TenantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PlanCode[]>(PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      tenantSlug?: string;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }>();

    const slug =
      req.user?.tenantSlug ||
      req.tenantSlug ||
      (typeof req.query?.tenantSlug === 'string' ? req.query.tenantSlug : undefined) ||
      (typeof req.body?.tenantSlug === 'string' ? (req.body.tenantSlug as string) : undefined);

    if (!slug) {
      throw new BadRequestException(
        'Não foi possível identificar o tenant para validar o plano (esperado em JWT, query ou body).',
      );
    }

    await this.tenants.assertPlan(slug, required);
    return true;
  }
}
