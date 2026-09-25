export type SalesTrendPoint = { date: string; revenue: number; count: number };

export function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Eixo X do mês corrente até hoje (fuso do navegador). */
export function buildLocalMonthTrendDaysThroughToday(): SalesTrendPoint[] {
  const now = new Date();
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: SalesTrendPoint[] = [];
  while (cursor.getTime() <= end.getTime()) {
    out.push({
      date: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      revenue: 0,
      count: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * API ≥ v1.0.88 envia `salesTrendMonth`. Versões antigas omitiam o campo — evita
 * “Sem vendas no mês” quando `sales.month` / `revenue.month` já trazem totais.
 */
export function resolveSalesTrendMonth(
  trend: SalesTrendPoint[] | undefined,
  monthSales: number,
  monthRevenue: number,
): { points: SalesTrendPoint[]; approximate: boolean } {
  if (trend && trend.length > 0) {
    const sumCount = trend.reduce((s, p) => s + p.count, 0);
    const sumRev = trend.reduce((s, p) => s + p.revenue, 0);
    if (sumCount > 0 || sumRev > 0) {
      return { points: trend, approximate: false };
    }
  }
  const days = buildLocalMonthTrendDaysThroughToday();
  if (monthSales <= 0 || monthRevenue <= 0) {
    return { points: days, approximate: false };
  }
  const today = localTodayIso();
  return {
    approximate: true,
    points: days.map((d) =>
      d.date === today
        ? { date: d.date, revenue: monthRevenue, count: monthSales }
        : d,
    ),
  };
}
