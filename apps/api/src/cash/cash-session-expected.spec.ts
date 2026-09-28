import { PaymentMethod, SaleStatus } from '../generated/tenant-client';
import { aggregateCompletedSalesTotals } from './cash-session-expected';

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
