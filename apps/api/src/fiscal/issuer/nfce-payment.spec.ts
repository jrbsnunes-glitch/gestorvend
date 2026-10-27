import { mapSalePaymentToNfcePag, paymentMethodToTPag, sanitizeXPag } from './nfce-payment';

describe('nfce-payment', () => {
  it('mapeia o catálogo interno para tPag oficial', () => {
    expect(paymentMethodToTPag('CASH')).toBe('01');
    expect(paymentMethodToTPag('PIX')).toBe('17');
    expect(paymentMethodToTPag('CREDIT')).toBe('05');
    expect(paymentMethodToTPag('REQUISITION')).toBe('91');
    expect(paymentMethodToTPag('OTHER')).toBe('99');
  });

  it('distingue cartão de crédito e débito', () => {
    expect(mapSalePaymentToNfcePag({ method: 'CARD', amount: 10, cardOperation: 'CREDIT' }).tPag).toBe(
      '03',
    );
    expect(mapSalePaymentToNfcePag({ method: 'CARD', amount: 10, cardOperation: 'DEBIT' }).tPag).toBe(
      '04',
    );
    expect(mapSalePaymentToNfcePag({ method: 'CARD', amount: 10 }).tPag).toBe('03');
  });

  it('requisição vira pagamento posterior, sem xPag', () => {
    const row = mapSalePaymentToNfcePag({ method: 'REQUISITION', amount: '45.00' });
    expect(row).toMatchObject({
      tPag: '91',
      vPag: 45,
      indPag: 1,
      label: 'Pagamento Posterior',
    });
    expect(row.xPag).toBeUndefined();
  });

  it('outros exige xPag (rejeição 441)', () => {
    const row = mapSalePaymentToNfcePag({
      method: 'OTHER',
      amount: 20,
      paymentFormName: 'Vale funcionário',
    });
    expect(row.tPag).toBe('99');
    expect(row.xPag).toBe('Vale funcionário');
    expect(row.label).toBe('Vale funcionário');
  });

  it('sanitizeXPag respeita 2–60 caracteres', () => {
    expect(sanitizeXPag('X')).toBe('Outros');
    expect(sanitizeXPag('  Pix loja  ')).toBe('Pix loja');
    expect(sanitizeXPag('A'.repeat(80))).toHaveLength(60);
  });
});
