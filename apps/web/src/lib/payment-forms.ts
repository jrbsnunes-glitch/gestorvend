/** Catálogo compartilhado: formas de pagamento e bandeiras (Brasil). */

export type PaymentFormKind = 'CASH' | 'CARD' | 'PIX' | 'CREDIT' | 'OTHER';
export type CardBrand =
  | 'VISA'
  | 'MASTERCARD'
  | 'ELO'
  | 'AMEX'
  | 'HIPERCARD'
  | 'CABAL'
  | 'DINERS'
  | 'SOROCRED'
  | 'ALELO'
  | 'VR'
  | 'TICKET'
  | 'OTHER';
export type CardOperation = 'CREDIT' | 'DEBIT';

export type PaymentForm = {
  id: string;
  name: string;
  kind: PaymentFormKind;
  isActive: boolean;
  sortOrder: number;
  cardBrand: CardBrand | null;
  cardOperation: CardOperation | null;
  adminFeePercent: string;
  adminFeeFixed: string;
  settlementDays: number;
  maxInstallments: number;
  notes: string | null;
};

export const PAYMENT_FORM_KIND_LABELS: Record<PaymentFormKind, string> = {
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  PIX: 'Pix',
  CREDIT: 'Crediário',
  OTHER: 'Outro',
};

export const CARD_BRAND_OPTIONS: Array<{ value: CardBrand; label: string }> = [
  { value: 'VISA', label: 'Visa' },
  { value: 'MASTERCARD', label: 'Mastercard' },
  { value: 'ELO', label: 'Elo' },
  { value: 'AMEX', label: 'American Express' },
  { value: 'HIPERCARD', label: 'Hipercard' },
  { value: 'CABAL', label: 'Cabal' },
  { value: 'DINERS', label: 'Diners Club' },
  { value: 'SOROCRED', label: 'Sorocred' },
  { value: 'ALELO', label: 'Alelo' },
  { value: 'VR', label: 'VR' },
  { value: 'TICKET', label: 'Ticket' },
  { value: 'OTHER', label: 'Outra' },
];

export function cardBrandLabel(brand: string | null | undefined): string {
  if (!brand) return '—';
  return CARD_BRAND_OPTIONS.find((b) => b.value === brand)?.label ?? brand;
}

export function cardOperationLabel(op: string | null | undefined): string {
  if (op === 'CREDIT') return 'Crédito';
  if (op === 'DEBIT') return 'Débito';
  return '—';
}

export function kindIcon(kind: PaymentFormKind): string {
  if (kind === 'CASH') return '💵';
  if (kind === 'CARD') return '💳';
  if (kind === 'PIX') return '⚡';
  if (kind === 'CREDIT') return '🧾';
  return '➕';
}

export function calcAdminFee(
  amount: number,
  feePercent: number | string,
  feeFixed: number | string,
): number {
  const pct = Number(feePercent) || 0;
  const fix = Number(feeFixed) || 0;
  return Math.round((amount * pct) / 100 * 100) / 100 + fix;
}
