/** Monta query string para `GET /reports/stock-position`. */
export function buildStockPositionReportQuery(p: {
  useMinControl: boolean;
  useMaxControl: boolean;
  alertsOnly: boolean;
  maxStockCeiling: string;
}): string {
  const params = new URLSearchParams({
    useMinControl: p.useMinControl ? '1' : '0',
    useMaxControl: p.useMaxControl ? '1' : '0',
    alertsOnly: p.alertsOnly ? '1' : '0',
  });
  if (p.useMaxControl && p.maxStockCeiling.trim()) {
    params.set('maxStockCeiling', p.maxStockCeiling.replace(',', '.'));
  }
  return params.toString();
}
