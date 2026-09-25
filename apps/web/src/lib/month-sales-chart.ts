export type MonthSalesPoint = { date: string; revenue: number; count: number };

/** Chave YYYY-MM do mês civil local — muda ao virar o mês e força novo fetch no React Query. */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isoDateLocal(y: number, monthIndex0: number, day: number): string {
  return `${y}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Eixo fixo: dia 01 do mês corrente até hoje (navegador / fuso da estação). */
export function buildCurrentMonthAxisThroughToday(): MonthSalesPoint[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDay = now.getDate();
  const out: MonthSalesPoint[] = [];
  for (let day = 1; day <= lastDay; day++) {
    out.push({ date: isoDateLocal(y, m, day), revenue: 0, count: 0 });
  }
  return out;
}

/** Mescla totais da API nos dias do eixo; ignora datas fora do mês corrente. */
export function mergeTrendIntoMonthAxis(
  axis: MonthSalesPoint[],
  apiPoints: MonthSalesPoint[] | undefined | null,
): MonthSalesPoint[] {
  if (!apiPoints?.length) return axis;
  const prefix = axis[0]?.date.slice(0, 7) ?? currentMonthKey();
  const map = new Map<string, MonthSalesPoint>();
  for (const p of apiPoints) {
    if (!p.date.startsWith(prefix)) continue;
    map.set(p.date, p);
  }
  return axis.map((d) => {
    const hit = map.get(d.date);
    return hit ?? d;
  });
}
