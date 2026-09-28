import { Prisma, PrismaClient } from '../generated/tenant-client';
import {
  endOfDay,
  formatLocalDateISO,
  startOfDay,
  startOfMonth,
} from '../common/date-range.util';
import { addCalendarDaysIso, calendarDayFromInstant } from '../common/iana-timezone.util';
import { getActiveTimezone } from '../common/tenant-timezone.context';

export type SalesTrendDay = { date: string; revenue: number; count: number };

export function appTimezone(): string {
  return getActiveTimezone();
}

export { endOfDay, startOfDay, startOfMonth };

export function dayKeyLocal(d: Date): string {
  return calendarDayFromInstant(d, getActiveTimezone());
}

/** Eixo contínuo do 1º dia do mês até hoje, mesclado com totais agregados. */
export function mergeSalesTrendAxis(
  monthStart: Date,
  through: Date,
  byDay: Map<string, { revenue: number; count: number }>,
): SalesTrendDay[] {
  const tz = getActiveTimezone();
  const out: SalesTrendDay[] = [];
  let date = formatLocalDateISO(monthStart);
  const endIso = formatLocalDateISO(through);
  while (date <= endIso) {
    const v = byDay.get(date) ?? { revenue: 0, count: 0 };
    out.push({ date, revenue: v.revenue, count: v.count });
    date = addCalendarDaysIso(date, 1, tz);
  }
  return out;
}

/**
 * Faturamento e quantidade por dia civil no fuso da loja (Company.timezone).
 * Evita carregar milhares de vendas e elimina erro de bucket em JS.
 */
export async function loadSalesTrendMonth(
  db: PrismaClient,
  monthStart: Date,
  todayEnd: Date,
  through: Date,
): Promise<SalesTrendDay[]> {
  const tz = appTimezone();
  const rows = await db.$queryRaw<Array<{ day: string; revenue: number; count: bigint | number }>>(
    Prisma.sql`
      SELECT
        to_char((timezone(${tz}, "createdAt"))::date, 'YYYY-MM-DD') AS day,
        COALESCE(SUM("total"), 0)::double precision AS revenue,
        COUNT(*)::bigint AS count
      FROM "Sale"
      WHERE status = 'COMPLETED'::"SaleStatus"
        AND "createdAt" >= ${monthStart}
        AND "createdAt" <= ${todayEnd}
      GROUP BY 1
      ORDER BY 1
    `,
  );

  const byDay = new Map<string, { revenue: number; count: number }>();
  for (const r of rows) {
    const day = String(r.day ?? '').trim();
    if (!day) continue;
    byDay.set(day, {
      revenue: Number(r.revenue ?? 0),
      count: Number(r.count ?? 0),
    });
  }
  return mergeSalesTrendAxis(monthStart, through, byDay);
}
