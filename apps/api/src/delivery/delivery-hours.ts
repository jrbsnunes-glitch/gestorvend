/** Horário operacional do canal delivery. */
export type DeliveryHours = {
  alwaysOpen?: boolean;
  /** Janela diária HH:mm–HH:mm (todos os dias). */
  daily?: [string, string];
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseDeliveryHours(raw: string | null | undefined): DeliveryHours {
  if (!raw?.trim()) return { alwaysOpen: true };
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j && typeof j === 'object') {
      if (j.alwaysOpen === true) return { alwaysOpen: true };
      const daily = j.daily;
      if (
        Array.isArray(daily) &&
        daily.length === 2 &&
        typeof daily[0] === 'string' &&
        typeof daily[1] === 'string' &&
        TIME_RE.test(daily[0]) &&
        TIME_RE.test(daily[1])
      ) {
        return { alwaysOpen: false, daily: [daily[0], daily[1]] };
      }
    }
  } catch {
    /* ignora JSON inválido */
  }
  return { alwaysOpen: true };
}

function minutesNowInZone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function parseHm(s: string): number {
  const [h, m] = s.split(':').map((n) => Number(n));
  return h * 60 + m;
}

export function isDeliveryOpenNow(
  hours: DeliveryHours,
  timeZone = 'America/Sao_Paulo',
): boolean {
  if (hours.alwaysOpen !== false || !hours.daily) return true;
  const [from, to] = hours.daily;
  const now = minutesNowInZone(timeZone);
  const a = parseHm(from);
  const b = parseHm(to);
  if (a === b) return true;
  if (a < b) return now >= a && now < b;
  return now >= a || now < b;
}

export function stringifyDeliveryHours(hours: DeliveryHours): string {
  if (hours.alwaysOpen !== false && !hours.daily) {
    return JSON.stringify({ alwaysOpen: true });
  }
  if (hours.daily) return JSON.stringify({ alwaysOpen: false, daily: hours.daily });
  return JSON.stringify({ alwaysOpen: true });
}
