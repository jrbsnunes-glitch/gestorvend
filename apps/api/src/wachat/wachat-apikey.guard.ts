import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Autenticação por API key dedicada à bridge GestorVendChat.
 * O segredo é lido de `WACHAT_API_KEY` e comparado ao header `X-WaChat-Key`.
 *
 * Quando válido, copia o `tenantSlug` (query/body) para `req.tenantSlug`, permitindo
 * que `PlanGuard` o utilize sem depender de JWT.
 */
@Injectable()
export class WaChatApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('WACHAT_API_KEY');
    if (!expected) {
      throw new UnauthorizedException(
        'Integração GestorVendChat desativada: defina WACHAT_API_KEY no .env da API.',
      );
    }

    const req = context.switchToHttp().getRequest<
      Request & { tenantSlug?: string }
    >();
    const provided = req.header('x-wachat-key') || req.header('X-WaChat-Key');

    if (!provided || provided !== expected) {
      throw new UnauthorizedException('API key inválida para a bridge GestorVendChat.');
    }

    const slugFromQuery = typeof req.query?.tenantSlug === 'string' ? (req.query.tenantSlug as string) : undefined;
    const slugFromBody =
      req.body && typeof (req.body as Record<string, unknown>).tenantSlug === 'string'
        ? ((req.body as Record<string, unknown>).tenantSlug as string)
        : undefined;
    const slug = slugFromQuery || slugFromBody;
    if (slug) {
      req.tenantSlug = slug;
    }
    return true;
  }
}
