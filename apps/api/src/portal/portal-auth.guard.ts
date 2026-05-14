import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export type PortalJwtPayload = {
  sub: string;
  email: string;
  name: string;
  kind: 'superadmin';
};

/**
 * Guard isolado para o portal de licenciamento.
 *
 * Aceita SOMENTE tokens emitidos pelo `PortalAuthController` (claim `kind:
 * 'superadmin'`). Mesmo se o cliente apresentar um JWT válido do tenant, será
 * rejeitado — o portal e o app principal vivem em "mundos" diferentes.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { portal?: PortalJwtPayload }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      throw new UnauthorizedException('Token ausente.');
    }
    try {
      const secret = this.config.get<string>('PORTAL_JWT_SECRET') ?? this.config.get<string>('JWT_ACCESS_SECRET');
      const payload = this.jwt.verify<PortalJwtPayload>(token, { secret });
      if (payload.kind !== 'superadmin') {
        throw new UnauthorizedException('Token não é do portal.');
      }
      req.portal = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token do portal inválido ou expirado.');
    }
  }
}
