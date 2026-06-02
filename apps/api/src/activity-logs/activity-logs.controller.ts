import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ActivityLogAction, Prisma } from '../generated/tenant-client';
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

const ACTION_LABELS: Record<ActivityLogAction, string> = {
  LOGIN: 'Acesso ao sistema',
  CASH_OPEN: 'Abertura de caixa',
  CASH_CLOSE: 'Fechamento de caixa',
  RECEIPT: 'Cupom / venda',
  FISCAL_DOC: 'Nota fiscal',
  REPORT: 'Relatório',
  CREATE: 'Inclusão',
  UPDATE: 'Alteração',
  DELETE: 'Exclusão',
};

@Controller('activity-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivityLogsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get('action-types')
  @Roles('admin')
  actionTypes() {
    return Object.entries(ACTION_LABELS).map(([key, label]) => ({ key, label }));
  }

  @Get()
  @Roles('admin')
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('userId') userId?: string,
    @Query('action') actionRaw?: string,
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
    const q = qRaw != null && String(qRaw).trim() !== '' ? String(qRaw).trim() : null;
    let action: ActivityLogAction | null = null;
    if (actionRaw != null && String(actionRaw).trim() !== '') {
      const a = String(actionRaw).trim() as ActivityLogAction;
      if (!Object.values(ActivityLogAction).includes(a)) {
        throw new BadRequestException('Tipo de ação inválido.');
      }
      action = a;
    }

    const and: Prisma.UserActivityLogWhereInput[] = [];
    if (uid) and.push({ userId: uid });
    if (action) and.push({ action });
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
          { summary: { contains: q, mode: 'insensitive' } },
          { entityType: { contains: q, mode: 'insensitive' } },
          { entityRef: { contains: q, mode: 'insensitive' } },
          { user: { name: { contains: q, mode: 'insensitive' } } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const rows = await db.userActivityLog.findMany({
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
        action: r.action,
        actionLabel: ACTION_LABELS[r.action],
        summary: r.summary,
        entityType: r.entityType,
        entityRef: r.entityRef,
        user: r.user,
      })),
    };
  }
}
