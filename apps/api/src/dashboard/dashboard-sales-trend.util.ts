import { Prisma, PrismaClient } from '../generated/tenant-client';

export type SalesTrendDay = { date: string; revenue: number; count: number };

export function appTimezone(): string {
  const tz = process.env.APP_TIMEZONE?.trim() || 'America/Sao_Paulo';
  return /^[A-Za-z0-9_+\/-]+$/.test(tz) ? tz : 'America/Sao_Paulo';
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function startOfMonth(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function dayKeyLocal(d: Date): string {
  const x = startOfDay(d);
  const m = `${x.getMonth() + 1}`.padStart(2, '0');
  const day = `${x.getDate()}`.padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
}

/** Eixo contínuo do 1º dia do mês até hoje, mesclado com totais agregados. */
export function mergeSalesTrendAxis(
  monthStart: Date,
  through: Date,
  byDay: Map<string, { revenue: number; count: number }>,
): SalesTrendDay[] {
  const out: SalesTrendDay[] = [];
  const cursor = new Date(monthStart);
  const end = startOfDay(through);
  while (cursor.getTime() <= end.getTime()) {
    const date = dayKeyLocal(cursor);
    const v = byDay.get(date) ?? { revenue: 0, count: 0 };
    out.push({ date, revenue: v.revenue, count: v.count });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Faturamento e quantidade por dia civil no fuso da loja (APP_TIMEZONE).
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
