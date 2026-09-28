/** Fuso IANA padrão por UF (Brasil). Demais UFs usam America/Sao_Paulo. */
const UF_TIMEZONE: Record<string, string> = {
  AC: 'America/Rio_Branco',
  AM: 'America/Manaus',
  MS: 'America/Cuiaba',
  MT: 'America/Cuiaba',
  RO: 'America/Porto_Velho',
  RR: 'America/Boa_Vista',
};

export const DEFAULT_BUSINESS_TIMEZONE = 'America/Sao_Paulo';

export function timezoneFromBrazilUf(uf: string | null | undefined): string {
  const key = String(uf ?? '')
    .trim()
    .toUpperCase();
  if (key.length !== 2) return DEFAULT_BUSINESS_TIMEZONE;
  return UF_TIMEZONE[key] ?? DEFAULT_BUSINESS_TIMEZONE;
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

export function resolveBusinessTimezone(
  company: { timezone?: string | null; state?: string | null } | null | undefined,
): string {
  const fromField = normalizeIanaTimezone(company?.timezone, '');
  if (fromField) return fromField;
  if (company?.state?.trim()) return timezoneFromBrazilUf(company.state);
  return DEFAULT_BUSINESS_TIMEZONE;
}

let activeBusinessTimezone: string | null = null;

export function setActiveBusinessTimezone(tz: string): void {
  activeBusinessTimezone = normalizeIanaTimezone(tz);
}

export function getActiveBusinessTimezone(): string {
  return activeBusinessTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function calendarDayFromInstant(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function calendarDayNow(timeZone: string): string {
  return calendarDayFromInstant(new Date(), timeZone);
}
