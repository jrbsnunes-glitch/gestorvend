import { PaymentMethod, SaleStatus } from '../generated/tenant-client';
import {
  aggregateCompletedSalesTotals,
  buildSalesByPaymentBreakdown,
  isDeferredSaleReceiptKey,
} from './cash-session-expected';

describe('aggregateCompletedSalesTotals', () => {
  it('compõe faturamento com recebido no ato e requisição', () => {
    const t = aggregateCompletedSalesTotals([
      {
        status: SaleStatus.COMPLETED,
        total: '100',
        payments: [
          { method: PaymentMethod.CASH, amount: '40' },
          { method: PaymentMethod.REQUISITION, amount: '60' },
        ],
      },
    ]);
    expect(t.totalInvoiced).toBe(100);
    expect(t.totalReceivedAtSale).toBe(40);
    expect(t.totalRequisitionAtSale).toBe(60);
    expect(t.totalReceivedAtSale + t.totalRequisitionAtSale).toBe(100);
  });
});

describe('buildSalesByPaymentBreakdown', () => {
  it('separa cartão crédito e débito e marca crédito como recebimento posterior', () => {
    const rows = buildSalesByPaymentBreakdown([
      {
        status: SaleStatus.COMPLETED,
        payments: [
          { method: PaymentMethod.CARD, amount: '80', cardOperation: 'CREDIT' },
          { method: PaymentMethod.CARD, amount: '20', cardOperation: 'DEBIT' },
          { method: PaymentMethod.REQUISITION, amount: '15' },
        ],
      },
    ]);
    const credit = rows.find((r) => r.key === 'CARD_CREDIT');
    const debit = rows.find((r) => r.key === 'CARD_DEBIT');
    expect(credit?.amount).toBe(80);
    expect(credit?.deferredReceipt).toBe(true);
    expect(debit?.amount).toBe(20);
    expect(debit?.deferredReceipt).toBe(false);
    expect(isDeferredSaleReceiptKey('REQUISITION')).toBe(true);
  });
});
