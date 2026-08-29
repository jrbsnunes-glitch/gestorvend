import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PaymentIntentMethod, PaymentIntentStatus, PaymentPspProvider } from '../../generated/tenant-client';
import {
  CardChargeResult,
  CreateCardChargeInput,
  CreatePixChargeInput,
  mapMercadoPagoOrderStatus,
  PaymentProviderAdapter,
  PaymentStatusResult,
  CreatePointOrderInput,
  PointChargeResult,
  PointTerminalInfo,
  PixChargeResult,
  ProviderCredentials,
} from './payment-provider.interface';

const MP_API = 'https://api.mercadopago.com';
const MP_FETCH_TIMEOUT_MS = 30_000;

@Injectable()
export class MercadoPagoProvider implements PaymentProviderAdapter {
  readonly provider = PaymentPspProvider.MERCADO_PAGO;

  private async api<T>(
    creds: ProviderCredentials,
    path: string,
    init?: RequestInit & { idempotencyKey?: string },
  ): Promise<T> {
    const token = creds.mercadoPago?.accessToken;
    if (!token) throw new BadRequestException('Access Token Mercado Pago ausente.');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (init?.idempotencyKey) headers['X-Idempotency-Key'] = init.idempotencyKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MP_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${MP_API}${path}`, { ...init, headers, signal: controller.signal });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new BadRequestException(
          'Mercado Pago não respondeu a tempo (30s). Verifique internet/firewall e o Access Token.',
        );
      }
      throw new BadRequestException(
        `Falha ao conectar na API Mercado Pago: ${e instanceof Error ? e.message : 'erro de rede'}`,
      );
    } finally {
      clearTimeout(timeout);
    }
    const text = await res.text();
    let json: T;
    try {
      json = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      throw new BadRequestException(`Mercado Pago resposta inválida (${res.status}).`);
    }
    if (!res.ok) {
      throw new BadRequestException(this.formatApiError(res.status, text));
    }
    return json;
  }

  private formatApiError(status: number, text: string): string {
    let code = '';
    try {
      const j = JSON.parse(text) as { code?: string; message?: string };
      code = j.code ?? '';
    } catch {
      /* raw text */
    }
    if (
      status === 403 &&
      (code === 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES' || text.includes('UNAUTHORIZED'))
    ) {
      return (
        'Mercado Pago recusou o acesso (403). A aplicação ou o Access Token não têm permissão ' +
        'para integração Point — homologue o app no painel de desenvolvedores MP e use credenciais ' +
        'da mesma conta/CNPJ da maquininha. Você pode vincular o device_id manualmente abaixo.'
      );
    }
    return `Mercado Pago erro ${status}: ${text.slice(0, 400)}`;
  }

  private extractPixQr(order: Record<string, unknown>): string | null {
    const txs = order.transactions as { payments?: Array<Record<string, unknown>> } | undefined;
    const pay = txs?.payments?.[0];
    if (!pay) return null;
    const pm = pay.payment_method as Record<string, unknown> | undefined;
    if (typeof pm?.qr_code === 'string') return pm.qr_code;
    if (typeof pm?.ticket_url === 'string') return pm.ticket_url;
    const poi = pay.point_of_interaction as { transaction_data?: { qr_code?: string } } | undefined;
    return poi?.transaction_data?.qr_code ?? null;
  }

  private isSandbox(creds: ProviderCredentials): boolean {
    const token = creds.mercadoPago?.accessToken ?? '';
    return creds.environment === 'SANDBOX' || token.startsWith('TEST-');
  }

  /** Sandbox MP exige e-mail @testuser.com (erro 400 invalid_email_for_sandbox). */
  private resolvePayerEmail(creds: ProviderCredentials, payerEmail?: string): string {
    const trimmed = payerEmail?.trim();
    if (trimmed) {
      if (this.isSandbox(creds) && !trimmed.endsWith('@testuser.com')) {
        return 'test_user_br@testuser.com';
      }
      return trimmed;
    }
    return this.isSandbox(creds) ? 'test_user_br@testuser.com' : 'cliente@gv.local';
  }

  private buildOrderBody(
    creds: ProviderCredentials,
    input: CreateCardChargeInput | CreatePixChargeInput,
    cardPart?: Record<string, unknown>,
  ) {
    const amount = input.amount.toFixed(2);
    const payerEmail = 'payerEmail' in input ? input.payerEmail : undefined;
    const payerDocument = 'payerDocument' in input ? input.payerDocument : undefined;
    const payment: Record<string, unknown> = {
      amount,
      ...(cardPart ?? {
        payment_method: {
          id: 'pix',
          type: 'bank_transfer',
        },
        expiration_time: `PT${Math.max(1, Math.floor((input as CreatePixChargeInput).expiresInSeconds ?? 900) / 60)}M`,
      }),
    };
    return {
      type: 'online',
      total_amount: amount,
      external_reference: input.orderReference,
      processing_mode: 'automatic',
      payer: {
        email: this.resolvePayerEmail(creds, payerEmail),
        ...(payerDocument
          ? { identification: { type: 'CPF', number: payerDocument.replace(/\D/g, '') } }
          : {}),
      },
      transactions: { payments: [payment] },
    };
  }

  async createPixCharge(creds: ProviderCredentials, input: CreatePixChargeInput): Promise<PixChargeResult> {
    const ttl = input.expiresInSeconds ?? creds.pixTimeoutSeconds;
    const order = await this.api<Record<string, unknown>>(creds, '/v1/orders', {
      method: 'POST',
      idempotencyKey: input.orderReference,
      body: JSON.stringify(this.buildOrderBody(creds, { ...input, expiresInSeconds: ttl })),
    });
    const externalId = String(order.id ?? '');
    if (!externalId) throw new BadRequestException('Mercado Pago não retornou order id.');
    const qrCode = this.extractPixQr(order);
    if (!qrCode) {
      throw new BadRequestException(
        'Mercado Pago não retornou QR PIX. Cadastre uma chave PIX na conta MP e use credenciais de teste (TEST-).',
      );
    }
    const txs = order.transactions as { payments?: Array<{ status?: string; status_detail?: string }> } | undefined;
    const pay = txs?.payments?.[0];
    const status = mapMercadoPagoOrderStatus(
      String(order.status ?? ''),
      pay?.status,
      pay?.status_detail,
    );
    return {
      externalId,
      qrCode,
      status,
      expiresAt: new Date(Date.now() + ttl * 1000),
      metadata: order,
    };
  }

  async createCardPayment(creds: ProviderCredentials, input: CreateCardChargeInput): Promise<CardChargeResult> {
    if (!input.cardToken || !input.paymentMethodId) {
      throw new BadRequestException('Token e bandeira do cartão são obrigatórios (Mercado Pago).');
    }
    const cardPart = {
      amount: input.amount.toFixed(2),
      payment_method: {
        id: input.paymentMethodId,
        type: input.paymentMethodType ?? 'credit_card',
        token: input.cardToken,
        installments: input.installments ?? 1,
      },
    };
    const order = await this.api<Record<string, unknown>>(creds, '/v1/orders', {
      method: 'POST',
      idempotencyKey: `${input.orderReference}-card`,
      body: JSON.stringify({
        ...this.buildOrderBody(creds, input, cardPart),
        transactions: { payments: [cardPart] },
      }),
    });
    const externalId = String(order.id ?? '');
    const txs = order.transactions as {
      payments?: Array<{ id?: string; status?: string; status_detail?: string; reference_id?: string }>;
    } | undefined;
    const pay = txs?.payments?.[0];
    const status = mapMercadoPagoOrderStatus(String(order.status ?? ''), pay?.status, pay?.status_detail);
    return {
      externalId,
      status,
      authCode: pay?.reference_id ?? pay?.id ?? null,
      metadata: order,
    };
  }

  async getPaymentStatus(
    creds: ProviderCredentials,
    externalId: string,
    _method: PaymentIntentMethod,
  ): Promise<PaymentStatusResult> {
    const order = await this.api<Record<string, unknown>>(
      creds,
      `/v1/orders/${encodeURIComponent(externalId)}`,
    );
    const txs = order.transactions as {
      payments?: Array<{ status?: string; status_detail?: string; reference_id?: string; id?: string }>;
    } | undefined;
    const pay = txs?.payments?.[0];
    return {
      status: mapMercadoPagoOrderStatus(String(order.status ?? ''), pay?.status, pay?.status_detail),
      authCode: pay?.reference_id ?? pay?.id ?? null,
      metadata: order,
    };
  }

  async cancelPayment(creds: ProviderCredentials, externalId: string, _method: PaymentIntentMethod): Promise<void> {
    await this.api(creds, `/v1/orders/${encodeURIComponent(externalId)}/cancel`, {
      method: 'POST',
      idempotencyKey: `cancel-${externalId}-${Date.now()}`,
      body: JSON.stringify({}),
    });
  }

  async listPointTerminals(creds: ProviderCredentials): Promise<PointTerminalInfo[]> {
    let listErr: string | null = null;
    try {
      const res = await this.api<{
        data?: Array<{
          id?: string;
          terminal_id?: string;
          operating_mode?: string;
          store_id?: string;
          pos_id?: string;
        }>;
      }>(creds, '/terminals/v1/list');
      const rows = res.data ?? [];
      const mapped = rows
        .map((r) => {
          const id = r.terminal_id ?? r.id;
          if (!id) return null;
          return {
            id: String(id),
            label: String(id),
            operatingMode: r.operating_mode ?? null,
            storeId: r.store_id != null ? String(r.store_id) : null,
            posId: r.pos_id != null ? String(r.pos_id) : null,
          };
        })
        .filter((x): x is PointTerminalInfo => x != null);
      if (mapped.length > 0) return mapped;
    } catch (e) {
      listErr = e instanceof BadRequestException ? e.message : String(e);
    }

    try {
      const legacy = await this.api<{
        devices?: Array<{
          id: string;
          operating_mode?: string;
          store_id?: string | number;
          pos_id?: string | number;
        }>;
      }>(creds, '/point/integration-api/devices?limit=50&offset=0');
      return (legacy.devices ?? []).map((d) => ({
        id: d.id,
        label: d.id,
        operatingMode: d.operating_mode ?? null,
        storeId: d.store_id != null ? String(d.store_id) : null,
        posId: d.pos_id != null ? String(d.pos_id) : null,
      }));
    } catch (e) {
      const legacyErr = e instanceof BadRequestException ? e.message : String(e);
      throw new BadRequestException(listErr ?? legacyErr);
    }
  }

  async createPointOrder(
    creds: ProviderCredentials,
    input: CreatePointOrderInput,
  ): Promise<PointChargeResult> {
    const amount = input.amount.toFixed(2);
    const body = {
      type: 'point',
      external_reference: input.orderReference,
      description: input.description ?? 'Venda GestorVend Kiosk',
      transactions: {
        payments: [
          {
            amount,
            payment_method: {
              type: input.paymentType,
            },
          },
        ],
      },
      config: {
        point: {
          terminal_id: input.terminalId,
          print_on_terminal: 'no_ticket',
        },
      },
    };
    const order = await this.api<Record<string, unknown>>(creds, '/v1/orders', {
      method: 'POST',
      idempotencyKey: input.orderReference,
      body: JSON.stringify(body),
    });
    const externalId = String(order.id ?? '');
    if (!externalId) throw new BadRequestException('Mercado Pago Point não retornou order id.');
    const txs = order.transactions as {
      payments?: Array<{ status?: string; status_detail?: string; reference_id?: string; id?: string }>;
    } | undefined;
    const pay = txs?.payments?.[0];
    const status = mapMercadoPagoOrderStatus(String(order.status ?? ''), pay?.status, pay?.status_detail);
    return {
      externalId,
      status,
      authCode: pay?.reference_id ?? pay?.id ?? null,
      metadata: { ...order, pointTerminalId: input.terminalId, paymentType: input.paymentType },
    };
  }

  validateWebhook(
    creds: ProviderCredentials,
    headers: Record<string, string | string[] | undefined>,
    _body: unknown,
    query: Record<string, string>,
  ): boolean {
    const secret = creds.mercadoPago?.webhookSecret;
    if (!secret) return true;
    const xSig = headers['x-signature'] ?? headers['X-Signature'];
    const xReq = headers['x-request-id'] ?? headers['X-Request-Id'];
    const sigStr = Array.isArray(xSig) ? xSig[0] : xSig;
    const reqId = Array.isArray(xReq) ? xReq[0] : xReq;
    if (!sigStr) return false;
    const dataId = query['data.id'] ?? query.data_id ?? '';
    const parts = Object.fromEntries(
      sigStr.split(',').map((p) => {
        const [k, v] = p.split('=');
        return [k.trim(), v?.trim() ?? ''];
      }),
    );
    const ts = parts.ts ?? '';
    const v1 = parts.v1 ?? '';
    if (!ts || !v1) return false;
    const manifest = `id:${dataId};request-id:${reqId ?? ''};ts:${ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
    } catch {
      return v1 === expected;
    }
  }

  extractWebhookExternalId(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as { data?: { id?: string }; id?: string };
    return b.data?.id != null ? String(b.data.id) : b.id != null ? String(b.id) : null;
  }
}
