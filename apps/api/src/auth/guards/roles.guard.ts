import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../roles.decorator';
import { JwtPayload } from '../strategies/jwt.strategy';
import { resolveMenuAccessEnforcement } from '../../users/menu-access.route-map';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      method?: string;
      url?: string;
      originalUrl?: string;
    }>();
    const user = req.user;
    if (!user?.roles?.length) {
      throw new ForbiddenException(
        'Seu usuário não tem perfil de acesso (RBAC). Peça ao administrador para vincular um perfil ou faça login novamente.',
      );
    }
    if (required.some((r) => user.roles.includes(r))) {
      return true;
    }

    // Caixa: mutações de menus da matriz — o MenuAccessInterceptor valida Incluir/Alterar/Excluir.
    const isSeller = user.roles.includes('seller');
    if (isSeller) {
      const enforcement = resolveMenuAccessEnforcement(
        String(req.method ?? 'GET'),
        String(req.originalUrl ?? req.url ?? ''),
      );
      if (enforcement) {
        return true;
      }
    }

    throw new ForbiddenException(
      `Acesso negado para esta operação. Perfis permitidos: ${required.join(', ')}.`,
    );
  }
}
