import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, from, switchMap } from 'rxjs';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  managerPasswordFromBody,
  resolveMenuAccessEnforcement,
} from './menu-access.route-map';
import { MenuAccessService } from './menu-access.service';

/**
 * Aplica a matriz de menus (Exibir/Incluir/Alterar/Excluir) nas mutações
 * mapeadas. Gerente/admin passam direto no MenuAccessService.
 */
@Injectable()
export class MenuAccessInterceptor implements NestInterceptor {
  constructor(private readonly menuAccess: MenuAccessService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;
    if (!user?.sub || !user.tenantSlug) {
      return next.handle();
    }

    // Gerente/admin: sem gate de matriz.
    if (this.menuAccess.isManagerOrAdmin(user.roles)) {
      return next.handle();
    }

    const enforcement = resolveMenuAccessEnforcement(req.method, req.url ?? req.originalUrl ?? '');
    if (!enforcement) {
      return next.handle();
    }

    return from(
      this.menuAccess.assertMenuAction(
        user.tenantSlug,
        user.sub,
        user.roles,
        enforcement.menuKey,
        enforcement.action,
        managerPasswordFromBody(req.body),
      ),
    ).pipe(switchMap(() => next.handle()));
  }
}
