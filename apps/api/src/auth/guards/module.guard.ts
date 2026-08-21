import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantModuleAddon } from '../../generated/central-client';
import { TenantService } from '../../tenant/tenant.service';
import { MODULE_KEY } from '../module.decorator';
import { JwtPayload } from '../strategies/jwt.strategy';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenants: TenantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<TenantModuleAddon[]>(MODULE_KEY, [
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
        'Não foi possível identificar o tenant para validar o módulo (esperado em JWT, query ou body).',
      );
    }

    const fromJwt = Array.isArray(req.user?.enabledModules)
      ? (req.user!.enabledModules as string[])
      : [];
    if (required.every((m) => fromJwt.includes(m))) {
      return true;
    }

    for (const mod of required) {
      await this.tenants.assertModule(slug, mod);
    }
    return true;
  }
}
