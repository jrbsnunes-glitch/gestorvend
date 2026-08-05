import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { PrintingService } from './printing.service';

/** Rate limit simples em memória: 120 req / IP / minuto (poll a cada ~3s). */
const hits = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 120;
const WINDOW_MS = 60_000;

function clientIp(req: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}): string {
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
      'Muitas requisições do agente de impressão. Tente novamente em instantes.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function extractToken(
  authHeader?: string,
  bodyToken?: string,
  xToken?: string,
): string {
  if (bodyToken?.trim()) return bodyToken.trim();
  if (xToken?.trim()) return xToken.trim();
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

@Controller('printing/agent')
export class PrintAgentController {
  constructor(private readonly printing: PrintingService) {}

  @Post('poll')
  async poll(
    @Query('tenant') tenant: string | undefined,
    @Body() body: { token?: string; limit?: number },
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-print-station-token') xToken: string | undefined,
    @Req()
    req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    assertRateLimit(clientIp(req));
    const slug = (tenant ?? '').trim().toLowerCase();
    if (!slug || slug.length < 2 || slug.length > 64) {
      throw new HttpException('Parâmetro tenant inválido.', HttpStatus.BAD_REQUEST);
    }
    const token = extractToken(authorization, body?.token, xToken);
    const station = await this.printing.authenticateStation(slug, token);
    const jobs = await this.printing.claimJobs(
      slug,
      station.id,
      station.sectors,
      body?.limit,
    );
    return {
      station: { id: station.id, name: station.name, sectors: station.sectors },
      jobs,
    };
  }

  @Post('jobs/:id/ack')
  async ack(
    @Param('id') id: string,
    @Query('tenant') tenant: string | undefined,
    @Body() body: { token?: string; ok?: boolean; error?: string },
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-print-station-token') xToken: string | undefined,
    @Req()
    req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    assertRateLimit(clientIp(req));
    const slug = (tenant ?? '').trim().toLowerCase();
    if (!slug || slug.length < 2 || slug.length > 64) {
      throw new HttpException('Parâmetro tenant inválido.', HttpStatus.BAD_REQUEST);
    }
    const token = extractToken(authorization, body?.token, xToken);
    const station = await this.printing.authenticateStation(slug, token);
    const updated = await this.printing.ackJob(slug, station.id, id, {
      ok: Boolean(body?.ok),
      error: body?.error,
    });
    return { ok: true, job: updated };
  }
}
