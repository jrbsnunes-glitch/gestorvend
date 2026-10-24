import { DEFAULT_BUSINESS_TIMEZONE } from './br-uf-timezone.util';

export function defaultAppTimezone(): string {
  return normalizeIanaTimezone(process.env.APP_TIMEZONE, DEFAULT_BUSINESS_TIMEZONE);
}

export function normalizeIanaTimezone(
  tz: string | null | undefined,
  fallback = DEFAULT_BUSINESS_TIMEZONE,
): string {
  const raw = String(tz ?? '').trim();
  if (!raw) return fallback;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: raw });
    return raw;
  } catch {
    return fallback;
  }
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const utc = date.getTime();
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utc;
}

function parseCalendarIso(iso: string): { y: number; mo: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new Error('Data inválida (use YYYY-MM-DD).');
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

/** Início do dia civil no fuso da loja → instante UTC. */
export function startOfCalendarDayUtc(iso: string, timeZone: string): Date {
  const { y, mo, d } = parseCalendarIso(iso);
  const probe = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
  const offsetMs = getTimeZoneOffsetMs(timeZone, probe);
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - offsetMs);
}

/** Fim do dia civil no fuso da loja → instante UTC. */
export function endOfCalendarDayUtc(iso: string, timeZone: string): Date {
  const { y, mo, d } = parseCalendarIso(iso);
  const probe = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
  const offsetMs = getTimeZoneOffsetMs(timeZone, probe);
  const nextUtcMidnight = Date.UTC(y, mo - 1, d + 1, 0, 0, 0, 0) - offsetMs;
  return new Date(nextUtcMidnight - 1);
}

/** YYYY-MM-DD “hoje” no fuso da loja. */
export function calendarDayNow(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Dia civil de um instante no fuso da loja. */
export function calendarDayFromInstant(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Meio-dia civil no fuso da loja (persistência de vencimentos). */
export function calendarDateAtNoonUtc(iso: string, timeZone: string): Date {
  const start = startOfCalendarDayUtc(iso, timeZone);
  return new Date(start.getTime() + 12 * 60 * 60 * 1000);
}

export function calendarDateAtNoonUtcFromInstant(instant: Date, timeZone: string): Date {
  const iso = calendarDayFromInstant(instant, timeZone);
  return calendarDateAtNoonUtc(iso, timeZone);
}

/**
 * Data/hora no fuso da loja no formato TDateTimeUTC da NF-e (AAAA-MM-DDThh:mm:ss±HH:00).
 * O XSD só admite minutos de offset 00.
 */
export function formatSefazDateTime(date: Date, timeZone: string): string {
  const tz = normalizeIanaTimezone(timeZone);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const offsetMin = Math.round(getTimeZoneOffsetMs(tz, date) / 60_000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const absH = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}${sign}${absH}:00`;
}

export function addCalendarDaysIso(iso: string, days: number, timeZone: string): string {
  const start = startOfCalendarDayUtc(iso, timeZone);
  const next = new Date(start.getTime() + days * 86_400_000);
  return calendarDayFromInstant(next, timeZone);
}
