/** Legenda em vendas com recebimento fora do caixa (rede, requisição, crediário). */
export const CASH_DEFERRED_RECEIPT_LABEL = 'Recebimento posterior';

export type CashPaymentBreakdownRow = {
  key: string;
  label: string;
  amount: number;
  deferredReceipt: boolean;
};

export type CancelledSaleReportRow = {
  id: string;
  number: number;
  createdAt: string;
  total: number;
  sessionControlNumber?: number;
};
