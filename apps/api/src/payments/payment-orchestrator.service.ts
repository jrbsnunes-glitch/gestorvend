import { Injectable } from '@nestjs/common';
import { PaymentPspProvider } from '../generated/tenant-client';
import { GetnetProvider } from './providers/getnet.provider';
import { MercadoPagoProvider } from './providers/mercado-pago.provider';
import { PaymentProviderAdapter } from './providers/payment-provider.interface';

@Injectable()
export class PaymentOrchestrator {
  private readonly byProvider: Map<PaymentPspProvider, PaymentProviderAdapter>;

  constructor(
    getnet: GetnetProvider,
    mercadoPago: MercadoPagoProvider,
  ) {
    this.byProvider = new Map<PaymentPspProvider, PaymentProviderAdapter>([
      [PaymentPspProvider.GETNET, getnet],
      [PaymentPspProvider.MERCADO_PAGO, mercadoPago],
    ]);
  }

  get(provider: PaymentPspProvider): PaymentProviderAdapter {
    const adapter = this.byProvider.get(provider);
    if (!adapter) throw new Error(`Provider ${provider} não registrado.`);
    return adapter;
  }
}
