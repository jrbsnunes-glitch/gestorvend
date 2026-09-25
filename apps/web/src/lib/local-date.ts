/** Datas locais em ISO YYYY-MM-DD (meio-dia evita deslocamento de fuso). */

export function todayISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addCalendarDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

export function endOfMonth(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${iso.slice(0, 8)}${String(last).padStart(2, '0')}`;
}

export function addMonths(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function monthGrid(iso: string): string[] {
  const start = startOfMonth(iso);
  const jsWeekday = new Date(start + 'T12:00:00').getDay();
  const lead = (jsWeekday + 6) % 7;
  const first = addCalendarDays(start, -lead);
  const monthKey = iso.slice(0, 7);
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) cells.push(addCalendarDays(first, i));
  while (cells.length > 7 && cells.slice(-7).every((c) => !c.startsWith(monthKey))) {
    cells.splice(-7, 7);
  }
  return cells;
}

export function monthTitle(iso: string): string {
  const raw = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Converte ISO datetime da API para data local YYYY-MM-DD. */
export function toLocalISODate(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseRangeEndUtc(toIso: string): Date {
  return new Date(`${toIso}T23:59:59.999`);
}

export function parseRangeStartUtc(fromIso: string): Date {
  return new Date(`${fromIso}T00:00:00.000`);
}
