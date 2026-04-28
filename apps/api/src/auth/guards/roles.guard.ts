import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../roles.decorator';
import { JwtPayload } from '../strategies/jwt.strategy';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = req.user;
    if (!user?.roles?.length) {
      throw new ForbiddenException(
        'Seu usuário não tem perfil de acesso (RBAC). Peça ao administrador para vincular um perfil ou faça login novamente.',
      );
    }
    if (!required.some((r) => user.roles.includes(r))) {
      throw new ForbiddenException(
        `Acesso negado para esta operação. Perfis permitidos: ${required.join(', ')}.`,
      );
    }
    return true;
  }
}
