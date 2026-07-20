export const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  PIX: 'Pix',
  CREDIT: 'Crediário',
  OTHER: 'Outro',
  EXPENSE: 'Despesa',
};

export type BillKind = 'pagar' | 'receber';

export type BillSettlementRow = {
  id: string;
  amount: string;
  paidAt?: string;
  receivedAt?: string;
  method: string | null;
  notes: string | null;
  cashSessionId: string | null;
  cashSession?: {
    controlNumber: number;
    user: { name: string } | null;
  } | null;
  referentialAccount?: {
    id: string;
    code: string;
    description: string;
  } | null;
};

export type BillWithSettlements = {
  id: string;
  description: string;
  amount: string;
  amountRemaining?: string;
  dueDate: string;
  status: string;
  paymentMethod?: string | null;
  settledAmount?: string | null;
  paymentNotes?: string | null;
  paidAt?: string | null;
  receivedAt?: string | null;
  supplier?: { legalName: string } | null;
  customer?: { name: string } | null;
  settlements?: BillSettlementRow[];
};

export function saldoAbertoBill(row: { amount: string; amountRemaining?: string | null }): string {
  const r = row.amountRemaining;
  if (r != null && String(r).trim() !== '') return String(r);
  return row.amount;
}

export function hasInformedPayment(row: {
  status?: string;
  settledAmount?: string | null;
}): boolean {
  if (row.status === 'PAID') return true;
  const n = Number(String(row.settledAmount ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0;
}

export function settlementDateIso(row: BillSettlementRow, kind: BillKind): string {
  const raw = kind === 'pagar' ? row.paidAt : row.receivedAt;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
