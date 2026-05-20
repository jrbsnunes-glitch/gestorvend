import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '../generated/tenant-client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseDay(raw: string | undefined, mode: 'start' | 'end'): Date | null {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return mode === 'end' ? endOfDay(date) : startOfDay(date);
  }
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return null;
  return mode === 'end' ? endOfDay(date) : startOfDay(date);
}

@Controller('activity-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivityLogsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** Grava acesso a uma tela (chamado pelo AppLayout ao mudar a rota). */
  @Post()
  @Roles('admin', 'manager', 'seller', 'finance')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      path?: string;
      menuKey?: string;
      menuLabel?: string;
      detail?: string | null;
    },
  ) {
    const path = String(body.path ?? '').trim();
    const menuKey = String(body.menuKey ?? '').trim();
    const menuLabel = String(body.menuLabel ?? '').trim();
    if (!path || !menuKey || !menuLabel) {
      throw new BadRequestException('Informe path, menuKey e menuLabel.');
    }
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const row = await db.userNavigationLog.create({
      data: {
        userId: user.sub,
        path: path.slice(0, 512),
        menuKey: menuKey.slice(0, 120),
        menuLabel: menuLabel.slice(0, 200),
        detail: body.detail != null && String(body.detail).trim() !== '' ? String(body.detail).trim().slice(0, 500) : null,
      },
    });
    return { id: row.id };
  }

  @Get()
  @Roles('admin')
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('userId') userId?: string,
    @Query('menuKey') menuKey?: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('q') qRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    const take = Math.min(500, Math.max(1, parseInt(String(takeRaw ?? '200'), 10) || 200));
    const fromD = parseDay(fromRaw, 'start');
    const toD = parseDay(toRaw, 'end');
    if (fromRaw && !fromD) throw new BadRequestException('Data inicial inválida (use YYYY-MM-DD).');
    if (toRaw && !toD) throw new BadRequestException('Data final inválida (use YYYY-MM-DD).');
    if (fromD && toD && toD.getTime() < fromD.getTime()) {
      throw new BadRequestException('Período inválido.');
    }

    const uid = userId != null && String(userId).trim() !== '' ? String(userId).trim() : null;
    const mk = menuKey != null && String(menuKey).trim() !== '' ? String(menuKey).trim() : null;
    const q = qRaw != null && String(qRaw).trim() !== '' ? String(qRaw).trim() : null;

    const and: Prisma.UserNavigationLogWhereInput[] = [];
    if (uid) and.push({ userId: uid });
    if (mk) and.push({ menuKey: mk });
    if (fromD || toD) {
      and.push({
        createdAt: {
          ...(fromD ? { gte: fromD } : {}),
          ...(toD ? { lte: toD } : {}),
        },
      });
    }
    if (q) {
      and.push({
        OR: [
          { path: { contains: q, mode: 'insensitive' } },
          { menuLabel: { contains: q, mode: 'insensitive' } },
          { menuKey: { contains: q, mode: 'insensitive' } },
          { detail: { contains: q, mode: 'insensitive' } },
          { user: { name: { contains: q, mode: 'insensitive' } } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const rows = await db.userNavigationLog.findMany({
      where: and.length ? { AND: and } : undefined,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return {
      take,
      count: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        path: r.path,
        menuKey: r.menuKey,
        menuLabel: r.menuLabel,
        detail: r.detail,
        user: r.user,
      })),
    };
  }
}
