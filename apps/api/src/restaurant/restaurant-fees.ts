/** Cálculo de taxas de salão (espelho do helper do front). */

export type RestaurantFeeMode = 'PERCENT' | 'FIXED';

export type RestaurantFeesCompany = {
  serviceFeeEnabled?: boolean;
  serviceFeeMode?: RestaurantFeeMode | string | null;
  serviceFeeValue?: unknown;
  couvertEnabled?: boolean;
  couvertMode?: RestaurantFeeMode | string | null;
  couvertValue?: unknown;
  waiterTipEnabled?: boolean;
  waiterTipMode?: RestaurantFeeMode | string | null;
  waiterTipValue?: unknown;
};

export type RestaurantFeesBreakdown = {
  serviceFee: number;
  couvert: number;
  waiterTip: number;
  feesTotal: number;
};

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toMode(raw: unknown): RestaurantFeeMode {
  return String(raw ?? '').toUpperCase() === 'FIXED' ? 'FIXED' : 'PERCENT';
}

function toNum(raw: unknown): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function calcOne(
  enabled: boolean,
  mode: RestaurantFeeMode,
  value: number,
  subtotal: number,
  multiplier: number,
): number {
  if (!enabled || value <= 0) return 0;
  if (mode === 'PERCENT') return roundMoney2((subtotal * value) / 100);
  return roundMoney2(value * Math.max(1, multiplier));
}

export function calcRestaurantFees(
  company: RestaurantFeesCompany | null | undefined,
  subtotalItems: number,
  guestCount = 1,
): RestaurantFeesBreakdown {
  const sub = Math.max(0, toNum(subtotalItems));
  const guests = Math.max(1, Math.floor(toNum(guestCount)) || 1);

  const serviceFee = calcOne(
    Boolean(company?.serviceFeeEnabled),
    toMode(company?.serviceFeeMode),
    toNum(company?.serviceFeeValue),
    sub,
    1,
  );
  const couvert = calcOne(
    Boolean(company?.couvertEnabled),
    toMode(company?.couvertMode),
    toNum(company?.couvertValue),
    sub,
    guests,
  );
  const waiterTip = calcOne(
    Boolean(company?.waiterTipEnabled),
    toMode(company?.waiterTipMode),
    toNum(company?.waiterTipValue),
    sub,
    1,
  );

  return {
    serviceFee,
    couvert,
    waiterTip,
    feesTotal: roundMoney2(serviceFee + couvert + waiterTip),
  };
}
