import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
} from '@nestjs/common';
import { TenantService } from './tenant.service';

/** Rate limit simples em memória: 30 req / IP / minuto. */
const hits = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 30;
const WINDOW_MS = 60_000;

function clientIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  return req.ip || 'unknown';
}

function assertRateLimit(ip: string) {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || cur.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  cur.count += 1;
  if (cur.count > LIMIT) {
    throw new HttpException(
      'Muitas consultas de licença. Tente novamente em instantes.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Controller('license')
export class LicenseController {
  constructor(private readonly tenants: TenantService) {}

  @Get('status')
  async status(@Query('tenant') tenant: string | undefined, @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> }) {
    assertRateLimit(clientIp(req));
    const slug = (tenant ?? '').trim().toLowerCase();
    if (!slug || slug.length < 2 || slug.length > 64) {
      throw new HttpException('Parâmetro tenant inválido.', HttpStatus.BAD_REQUEST);
    }
    return this.tenants.getPublicLicenseStatus(slug);
  }
}
