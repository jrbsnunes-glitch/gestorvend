import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentIntentStatus, PaymentPspEnvironment, PaymentPspProvider } from '../../generated/tenant-client';
import {
  CardChargeResult,
  CreateCardChargeInput,
  CreatePixChargeInput,
  mapGetnetStatus,
  PaymentProviderAdapter,
  PaymentStatusResult,
  PixChargeResult,
  ProviderCredentials,
} from './payment-provider.interface';
import { PaymentIntentMethod } from '../../generated/tenant-client';

type TokenCache = { token: string; expiresAt: number };

@Injectable()
export class GetnetProvider implements PaymentProviderAdapter {
  readonly provider = PaymentPspProvider.GETNET;
  private tokenCache = new Map<string, TokenCache>();

  private baseUrl(env: PaymentPspEnvironment): string {
    return env === PaymentPspEnvironment.PRODUCTION
      ? 'https://api-backoffice.getnet.com.br'
      : 'https://api-homologacao.getnet.com.br';
  }

  private cacheKey(creds: ProviderCredentials): string {
    return `${creds.environment}:${creds.getnet?.clientId ?? ''}`;
  }

  private async getToken(creds: ProviderCredentials): Promise<string> {
    const g = creds.getnet;
    if (!g) throw new BadRequestException('Credenciais Getnet ausentes.');
    const key = this.cacheKey(creds);
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

    const res = await fetch(`${this.baseUrl(creds.environment)}/auth/oauth/v2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${g.clientId}:${g.clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials&scope=oob',
    }).catch(async () => {
      return fetch(`${this.baseUrl(creds.environment)}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: g.clientId,
          client_secret: g.clientSecret,
          grant_type: 'client_credentials',
        }),
      });
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(`Getnet auth falhou (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number | string };
    if (!json.access_token) throw new BadRequestException('Getnet não retornou access_token.');
    const expiresIn = Number(json.expires_in ?? 3600);
    this.tokenCache.set(key, {
      token: json.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    return json.access_token;
  }

  private async api<T>(
    creds: ProviderCredentials,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const token = await this.getToken(creds);
    const res = await fetch(`${this.baseUrl(creds.environment)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let json: T;
    try {
      json = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      throw new BadRequestException(`Getnet resposta inválida (${res.status}).`);
    }
    if (!res.ok) {
      throw new BadRequestException(`Getnet erro ${res.status}: ${text.slice(0, 300)}`);
    }
    return json;
  }

  async createPixCharge(creds: ProviderCredentials, input: CreatePixChargeInput): Promise<PixChargeResult> {
    const ttl = input.expiresInSeconds ?? creds.pixTimeoutSeconds;
    const json = await this.api<{
      payment_id?: string;
      qrcode?: string;
      status?: string;
    }>(creds, '/v2/payments/qrcode/pix', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        order_id: input.orderReference,
        pix: { description: input.description.slice(0, 140) },
      }),
    });
    const externalId = json.payment_id ?? '';
    if (!externalId) throw new BadRequestException('Getnet não retornou payment_id.');
    return {
      externalId,
      qrCode: json.qrcode ?? null,
      status: mapGetnetStatus(json.status),
      expiresAt: new Date(Date.now() + ttl * 1000),
      metadata: json as Record<string, unknown>,
    };
  }

  async createCardPayment(creds: ProviderCredentials, input: CreateCardChargeInput): Promise<CardChargeResult> {
    const paymentMethod: Record<string, unknown> = { type: 'credit_card' };
    if (input.getnetCardId) {
      paymentMethod.card_id = input.getnetCardId;
    } else if (input.getnetCard) {
      paymentMethod.card = {
        number: input.getnetCard.number,
        holder: input.getnetCard.holder,
        expiration_date: input.getnetCard.expirationDate,
        cvv: input.getnetCard.cvv,
      };
    } else {
      throw new BadRequestException('Informe getnetCardId ou dados do cartão para Getnet.');
    }

    const json = await this.api<{
      payment_id?: string;
      status?: string;
      authorization_code?: string;
    }>(creds, '/v2/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        currency: 'BRL',
        order_id: input.orderReference,
        payment_method: paymentMethod,
      }),
    });
    const externalId = json.payment_id ?? '';
    if (!externalId) throw new BadRequestException('Getnet não retornou payment_id.');
    const status = mapGetnetStatus(json.status);
    return {
      externalId,
      status,
      authCode: json.authorization_code ?? null,
      metadata: json as Record<string, unknown>,
    };
  }

  async getPaymentStatus(
    creds: ProviderCredentials,
    externalId: string,
    _method: PaymentIntentMethod,
  ): Promise<PaymentStatusResult> {
    const json = await this.api<{
      status?: string;
      authorization_code?: string;
      payment?: { status?: string; authorization_code?: string };
    }>(creds, `/v1/payments/info/${encodeURIComponent(externalId)}`);
    const raw = json.payment?.status ?? json.status;
    return {
      status: mapGetnetStatus(raw),
      authCode: json.payment?.authorization_code ?? json.authorization_code ?? null,
      metadata: json as Record<string, unknown>,
    };
  }

  async cancelPayment(creds: ProviderCredentials, externalId: string, _method: PaymentIntentMethod): Promise<void> {
    await this.api(creds, '/v2/payments/cancel', {
      method: 'POST',
      body: JSON.stringify({ payment_id: externalId }),
    });
  }

  validateWebhook(
    creds: ProviderCredentials,
    headers: Record<string, string | string[] | undefined>,
    _body: unknown,
    _query?: Record<string, string>,
  ): boolean {
    const user = creds.getnet?.webhookUser;
    const pass = creds.getnet?.webhookPassword;
    if (!user || !pass) return true;
    const auth = headers.authorization ?? headers.Authorization;
    const authStr = Array.isArray(auth) ? auth[0] : auth;
    if (!authStr?.startsWith('Basic ')) return false;
    const decoded = Buffer.from(authStr.slice(6), 'base64').toString('utf8');
    const [u, p] = decoded.split(':');
    return u === user && p === pass;
  }

  extractWebhookExternalId(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    const id = b.payment_id ?? b.paymentId ?? b.id;
    return id != null ? String(id) : null;
  }
}
