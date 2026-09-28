import { PaymentMethod } from '../generated/tenant-client';
import { splitSalePayments } from './sales-payment-breakdown.util';

describe('splitSalePayments', () => {
  it('separa requisição do restante', () => {
    const r = splitSalePayments([
      { method: PaymentMethod.PIX, amount: '50' },
      { method: PaymentMethod.REQUISITION, amount: '50' },
    ]);
    expect(r.receivedAtSale).toBe(50);
    expect(r.requisitionAtSale).toBe(50);
    expect(r.creditFromBalance).toBe(0);
  });

  it('contabiliza saldo crediário em receivedAtSale', () => {
    const r = splitSalePayments([
      { method: PaymentMethod.CREDIT, amount: '30' },
      { method: PaymentMethod.REQUISITION, amount: '70' },
    ]);
    expect(r.receivedAtSale).toBe(30);
    expect(r.creditFromBalance).toBe(30);
    expect(r.requisitionAtSale).toBe(70);
  });
});
