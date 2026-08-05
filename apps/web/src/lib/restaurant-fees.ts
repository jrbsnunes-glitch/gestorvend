/** Modo de cobrança das taxas de salão. */
export type RestaurantFeeMode = 'PERCENT' | 'FIXED';

export type RestaurantFeeConfig = {
  enabled: boolean;
  mode: RestaurantFeeMode;
  value: number;
};

export type RestaurantFeesCompany = {
  serviceFeeEnabled?: boolean;
  serviceFeeMode?: RestaurantFeeMode | string | null;
  serviceFeeValue?: string | number | null;
  couvertEnabled?: boolean;
  couvertMode?: RestaurantFeeMode | string | null;
  couvertValue?: string | number | null;
  waiterTipEnabled?: boolean;
  waiterTipMode?: RestaurantFeeMode | string | null;
  waiterTipValue?: string | number | null;
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

function calcOne(cfg: RestaurantFeeConfig, subtotal: number, guestCount: number): number {
  if (!cfg.enabled || cfg.value <= 0) return 0;
  if (cfg.mode === 'PERCENT') {
    return roundMoney2((subtotal * cfg.value) / 100);
  }
  // FIXED: couvert multiplica por pessoas; serviço/garçom são valor único.
  return roundMoney2(cfg.value * Math.max(1, guestCount));
}

/**
 * Calcula taxas de salão a partir do cadastro da empresa + subtotal dos itens + pessoas.
 * Couvert FIXED = valor × guestCount; serviço/garçom FIXED = valor único (guestCount forçado a 1).
 */
export function calcRestaurantFees(
  company: RestaurantFeesCompany | null | undefined,
  subtotalItems: number,
  guestCount = 1,
): RestaurantFeesBreakdown {
  const sub = Math.max(0, toNum(subtotalItems));
  const guests = Math.max(1, Math.floor(toNum(guestCount)) || 1);

  const serviceFee = calcOne(
    {
      enabled: Boolean(company?.serviceFeeEnabled),
      mode: toMode(company?.serviceFeeMode),
      value: toNum(company?.serviceFeeValue),
    },
    sub,
    1,
  );

  const couvert = calcOne(
    {
      enabled: Boolean(company?.couvertEnabled),
      mode: toMode(company?.couvertMode),
      value: toNum(company?.couvertValue),
    },
    sub,
    guests,
  );

  const waiterTip = calcOne(
    {
      enabled: Boolean(company?.waiterTipEnabled),
      mode: toMode(company?.waiterTipMode),
      value: toNum(company?.waiterTipValue),
    },
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

export function companyToFeeConfigs(company: RestaurantFeesCompany | null | undefined) {
  return {
    service: {
      enabled: Boolean(company?.serviceFeeEnabled),
      mode: toMode(company?.serviceFeeMode),
      value: toNum(company?.serviceFeeValue),
    } satisfies RestaurantFeeConfig,
    couvert: {
      enabled: Boolean(company?.couvertEnabled),
      mode: toMode(company?.couvertMode),
      value: toNum(company?.couvertValue),
    } satisfies RestaurantFeeConfig,
    waiterTip: {
      enabled: Boolean(company?.waiterTipEnabled),
      mode: toMode(company?.waiterTipMode),
      value: toNum(company?.waiterTipValue),
    } satisfies RestaurantFeeConfig,
  };
}
