import {
  calendarDayFromInstant,
  calendarDayNow,
  getActiveBusinessTimezone,
} from './business-timezone';

/** Caixa aberto em um dia civil diferente do atual (fuso da empresa). */
export function cashSessionFromPreviousDay(
  openedAt: string | Date | null | undefined,
  timeZone = getActiveBusinessTimezone(),
): boolean {
  if (!openedAt) return false;
  const opened = openedAt instanceof Date ? openedAt : new Date(openedAt);
  if (Number.isNaN(opened.getTime())) return false;
  return calendarDayFromInstant(opened, timeZone) !== calendarDayNow(timeZone);
}

export const STALE_CASH_SALE_BLOCK_MESSAGE =
  'Caixa aberto em outro dia. Feche o caixa atual e abra um novo para registrar as vendas de hoje.';
