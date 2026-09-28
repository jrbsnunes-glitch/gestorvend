/**
 * Parsing de datas em query strings no fuso da loja (Company.timezone / UF).
 * YYYY-MM-DD = dia civil nesse fuso, convertido para instante UTC.
 */

import {
  calendarDateAtNoonUtc,
  calendarDateAtNoonUtcFromInstant,
  calendarDayFromInstant,
  calendarDayNow,
  endOfCalendarDayUtc,
  startOfCalendarDayUtc,
} from './iana-timezone.util';
import { getActiveTimezone } from './tenant-timezone.context';

export function startOfDay(d: Date): Date {
  const tz = getActiveTimezone();
  const iso = calendarDayFromInstant(d, tz);
  return startOfCalendarDayUtc(iso, tz);
}

export function endOfDay(d: Date): Date {
  const tz = getActiveTimezone();
  const iso = calendarDayFromInstant(d, tz);
  return endOfCalendarDayUtc(iso, tz);
}

/** YYYY-MM-DD no fuso da loja (evita `toISOString()` deslocar o dia). */
export function formatLocalDateISO(d: Date): string {
  return calendarDayFromInstant(d, getActiveTimezone());
}

export function startOfToday(): Date {
  const tz = getActiveTimezone();
  return startOfCalendarDayUtc(calendarDayNow(tz), tz);
}

export function endOfToday(): Date {
  const tz = getActiveTimezone();
  return endOfCalendarDayUtc(calendarDayNow(tz), tz);
}

export function parseQueryDate(raw: string, mode: 'start' | 'end'): Date {
  const tz = getActiveTimezone();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (dateOnly) {
    const iso = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    return mode === 'end' ? endOfCalendarDayUtc(iso, tz) : startOfCalendarDayUtc(iso, tz);
  }
  return new Date(raw);
}

/** Meio-dia civil no fuso da loja — persistência de vencimentos. */
export function calendarDateAtLocalNoon(d: Date): Date {
  return calendarDateAtNoonUtcFromInstant(d, getActiveTimezone());
}

export function calendarDateAtLocalNoonFromIso(iso: string): Date {
  return calendarDateAtNoonUtc(iso.trim().slice(0, 10), getActiveTimezone());
}

export function startOfMonth(d: Date): Date {
  const tz = getActiveTimezone();
  const iso = calendarDayFromInstant(d, tz);
  const monthStart = `${iso.slice(0, 7)}-01`;
  return startOfCalendarDayUtc(monthStart, tz);
}
