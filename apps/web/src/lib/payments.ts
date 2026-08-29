export type PaymentPspProvider = 'GETNET' | 'MERCADO_PAGO';

export type PaymentSettings = {
  id: string;
  activeProvider: PaymentPspProvider | null;
  getnetEnabled: boolean;
  mercadoPagoEnabled: boolean;
  environment: 'SANDBOX' | 'PRODUCTION';
  pixEnabled: boolean;
  cardEnabled: boolean;
  pixTimeoutSeconds: number;
  pixKeyType: string | null;
  pixKey: string | null;
  mercadoPagoPublicKey: string | null;
  hasGetnetCredentials: boolean;
  hasMercadoPagoCredentials: boolean;
  webhookUrls: {
    getnet: string;
    mercadoPago: string;
  };
};

export type PdvPaymentSettings = {
  activeProvider: PaymentPspProvider | null;
  getnetEnabled: boolean;
  mercadoPagoEnabled: boolean;
  pixEnabled: boolean;
  cardEnabled: boolean;
  mercadoPagoPublicKey: string | null;
  hasOnlinePix: boolean;
  hasOnlineCard: boolean;
};

export type PaymentIntent = {
  id: string;
  method: 'PIX' | 'CARD';
  status: 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED' | 'FAILED';
  provider: PaymentPspProvider;
  amount: string;
  qrCode: string | null;
  expiresAt: string | null;
  confirmedAt: string | null;
  authCode: string | null;
  externalId?: string | null;
};

export function paymentProviderLabel(p: PaymentPspProvider): string {
  return p === 'GETNET' ? 'Getnet' : 'Mercado Pago';
}

export function paymentIntentStatusLabel(s: PaymentIntent['status']): string {
  const map: Record<PaymentIntent['status'], string> = {
    PENDING: 'Aguardando',
    PROCESSING: 'Processando',
    CONFIRMED: 'Confirmado',
    EXPIRED: 'Expirado',
    CANCELLED: 'Cancelado',
    FAILED: 'Falhou',
  };
  return map[s] ?? s;
}
