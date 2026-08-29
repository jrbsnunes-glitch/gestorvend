import {
  PaymentIntentMethod,
  PaymentIntentStatus,
  PaymentPspEnvironment,
  PaymentPspProvider,
} from '../../generated/tenant-client';

export type ProviderCredentials = {
  provider: PaymentPspProvider;
  environment: PaymentPspEnvironment;
  getnet?: {
    clientId: string;
    clientSecret: string;
    channel?: string;
    scope?: string;
    webhookUser?: string;
    webhookPassword?: string;
  };
  mercadoPago?: {
    accessToken: string;
    publicKey?: string;
    webhookSecret?: string;
  };
  pixKey?: string;
  pixKeyType?: string;
  pixTimeoutSeconds: number;
};

export type CreatePixChargeInput = {
  amount: number;
  orderReference: string;
  description: string;
  payerEmail?: string;
  expiresInSeconds?: number;
};

export type CreateCardChargeInput = {
  amount: number;
  orderReference: string;
  payerEmail: string;
  payerDocument?: string;
  installments?: number;
  /** Mercado Pago card token from Brick. */
  cardToken?: string;
  paymentMethodId?: string;
  paymentMethodType?: 'credit_card' | 'debit_card';
  /** Getnet vault card id. */
  getnetCardId?: string;
  /** Getnet direct card (server-side only). */
  getnetCard?: {
    number: string;
    holder: string;
    expirationDate: string;
    cvv: string;
  };
};

export type CreatePointOrderInput = {
  amount: number;
  orderReference: string;
  terminalId: string;
  paymentType: 'credit_card' | 'debit_card';
  description?: string;
};

export type PointTerminalInfo = {
  id: string;
  label: string;
  operatingMode: string | null;
  storeId: string | null;
  posId: string | null;
};

export type PointChargeResult = {
  externalId: string;
  status: PaymentIntentStatus;
  authCode?: string | null;
  metadata?: Record<string, unknown>;
};

export type PixChargeResult = {
  externalId: string;
  qrCode: string | null;
  status: PaymentIntentStatus;
  expiresAt: Date | null;
  metadata?: Record<string, unknown>;
};

export type CardChargeResult = {
  externalId: string;
  status: PaymentIntentStatus;
  authCode?: string | null;
  metadata?: Record<string, unknown>;
};

export type PaymentStatusResult = {
  status: PaymentIntentStatus;
  authCode?: string | null;
  metadata?: Record<string, unknown>;
};

export interface PaymentProviderAdapter {
  readonly provider: PaymentPspProvider;
  createPixCharge(creds: ProviderCredentials, input: CreatePixChargeInput): Promise<PixChargeResult>;
  createCardPayment(creds: ProviderCredentials, input: CreateCardChargeInput): Promise<CardChargeResult>;
  getPaymentStatus(creds: ProviderCredentials, externalId: string, method: PaymentIntentMethod): Promise<PaymentStatusResult>;
  cancelPayment(creds: ProviderCredentials, externalId: string, method: PaymentIntentMethod): Promise<void>;
  validateWebhook?(
    creds: ProviderCredentials,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    query: Record<string, string>,
  ): boolean;
  extractWebhookExternalId?(body: unknown): string | null;
}

export function mapGetnetStatus(raw: string | undefined): PaymentIntentStatus {
  const s = (raw ?? '').toLowerCase();
  if (['approved', 'paid', 'confirmed', 'captured', 'success'].some((x) => s.includes(x))) {
    return PaymentIntentStatus.CONFIRMED;
  }
  if (['cancel', 'void', 'refunded'].some((x) => s.includes(x))) {
    return PaymentIntentStatus.CANCELLED;
  }
  if (['expir', 'timeout'].some((x) => s.includes(x))) {
    return PaymentIntentStatus.EXPIRED;
  }
  if (['denied', 'failed', 'error', 'declined'].some((x) => s.includes(x))) {
    return PaymentIntentStatus.FAILED;
  }
  if (['pending', 'processing', 'waiting', 'authorized'].some((x) => s.includes(x))) {
    return PaymentIntentStatus.PROCESSING;
  }
  return PaymentIntentStatus.PENDING;
}

export function mapMercadoPagoOrderStatus(
  orderStatus?: string,
  paymentStatus?: string,
  statusDetail?: string,
): PaymentIntentStatus {
  const ps = (paymentStatus ?? '').toLowerCase();
  const os = (orderStatus ?? '').toLowerCase();
  const sd = (statusDetail ?? '').toLowerCase();
  if (ps === 'processed' && (sd === 'accredited' || sd === 'approved')) {
    return PaymentIntentStatus.CONFIRMED;
  }
  if (['cancelled', 'canceled', 'expired'].some((x) => os.includes(x) || ps.includes(x))) {
    return os.includes('expir') || ps.includes('expir') || sd.includes('expir')
      ? PaymentIntentStatus.EXPIRED
      : PaymentIntentStatus.CANCELLED;
  }
  if (['rejected', 'failed', 'error'].some((x) => ps.includes(x) || sd.includes(x))) {
    return PaymentIntentStatus.FAILED;
  }
  if (['processing', 'pending', 'in_process'].some((x) => ps.includes(x) || os.includes(x))) {
    return PaymentIntentStatus.PROCESSING;
  }
  if (os === 'at_terminal' || os === 'created') {
    return PaymentIntentStatus.PROCESSING;
  }
  if (os === 'processed') return PaymentIntentStatus.CONFIRMED;
  return PaymentIntentStatus.PENDING;
}
