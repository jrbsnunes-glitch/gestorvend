import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PaymentIntentMethod, PaymentIntentStatus, PaymentPspProvider, Prisma } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PaymentCredentialsService } from './payment-credentials.service';
import { PaymentOrchestrator } from './payment-orchestrator.service';
import { MercadoPagoProvider } from './providers/mercado-pago.provider';
import { CreateCardChargeInput, CreatePixChargeInput, PointTerminalInfo } from './providers/payment-provider.interface';

export type PaymentIntentDto = {
  id: string;
  method: PaymentIntentMethod;
  status: PaymentIntentStatus;
  provider: PaymentPspProvider;
  amount: string;
  currency: string;
  externalId: string | null;
  orderReference: string;
  qrCode: string | null;
  expiresAt: string | null;
  confirmedAt: string | null;
  authCode: string | null;
  saleId: string | null;
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly credentials: PaymentCredentialsService,
    private readonly orchestrator: PaymentOrchestrator,
    private readonly mercadoPago: MercadoPagoProvider,
  ) {}

  toDto(row: {
    id: string;
    method: PaymentIntentMethod;
    status: PaymentIntentStatus;
    provider: PaymentPspProvider;
    amount: { toString(): string };
    currency: string;
    externalId: string | null;
    orderReference: string;
    qrCode: string | null;
    expiresAt: Date | null;
    confirmedAt: Date | null;
    saleId: string | null;
    metadata?: unknown;
  }): PaymentIntentDto {
    const meta = row.metadata as { authCode?: string } | null;
    return {
      id: row.id,
      method: row.method,
      status: row.status,
      provider: row.provider,
      amount: row.amount.toString(),
      currency: row.currency,
      externalId: row.externalId,
      orderReference: row.orderReference,
      qrCode: row.qrCode,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      authCode: meta?.authCode ?? null,
      saleId: row.saleId,
    };
  }

  async createPixCharge(
    tenantSlug: string,
    input: { amount: number; description?: string; payerEmail?: string; provider?: PaymentPspProvider },
  ): Promise<PaymentIntentDto> {
    if (input.amount <= 0) throw new BadRequestException('Valor inválido.');
    const settings = await this.credentials.getOrCreateSettings(tenantSlug);
    if (!settings.pixEnabled) throw new BadRequestException('PIX online desabilitado.');
    const provider = await this.credentials.resolveActiveProvider(tenantSlug, input.provider);
    const creds = await this.credentials.resolveCredentials(tenantSlug, provider);
    const orderReference = `GV-${randomUUID()}`;
    const chargeInput: CreatePixChargeInput = {
      amount: input.amount,
      orderReference,
      description: input.description ?? 'Venda GestorVend',
      payerEmail: input.payerEmail,
      expiresInSeconds: settings.pixTimeoutSeconds,
    };
    const adapter = this.orchestrator.get(provider);
    const result = await adapter.createPixCharge(creds, chargeInput);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.paymentIntent.create({
      data: {
        method: PaymentIntentMethod.PIX,
        status: result.status,
        provider,
        amount: String(input.amount.toFixed(2)),
        externalId: result.externalId,
        orderReference,
        qrCode: result.qrCode,
        expiresAt: result.expiresAt,
        metadata: (result.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return this.toDto(row);
  }

  async createCardCharge(
    tenantSlug: string,
    input: {
      amount: number;
      payerEmail: string;
      payerDocument?: string;
      provider?: PaymentPspProvider;
      installments?: number;
      cardToken?: string;
      paymentMethodId?: string;
      paymentMethodType?: 'credit_card' | 'debit_card';
      getnetCardId?: string;
      getnetCard?: CreateCardChargeInput['getnetCard'];
    },
  ): Promise<PaymentIntentDto> {
    if (input.amount <= 0) throw new BadRequestException('Valor inválido.');
    const settings = await this.credentials.getOrCreateSettings(tenantSlug);
    if (!settings.cardEnabled) throw new BadRequestException('Cartão online desabilitado.');
    const provider = await this.credentials.resolveActiveProvider(tenantSlug, input.provider);
    const creds = await this.credentials.resolveCredentials(tenantSlug, provider);
    const orderReference = `GV-${randomUUID()}`;
    const chargeInput: CreateCardChargeInput = {
      amount: input.amount,
      orderReference,
      payerEmail: input.payerEmail,
      payerDocument: input.payerDocument,
      installments: input.installments,
      cardToken: input.cardToken,
      paymentMethodId: input.paymentMethodId,
      paymentMethodType: input.paymentMethodType,
      getnetCardId: input.getnetCardId,
      getnetCard: input.getnetCard,
    };
    const adapter = this.orchestrator.get(provider);
    const result = await adapter.createCardPayment(creds, chargeInput);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.paymentIntent.create({
      data: {
        method: PaymentIntentMethod.CARD,
        status: result.status,
        provider,
        amount: String(input.amount.toFixed(2)),
        externalId: result.externalId,
        orderReference,
        confirmedAt: result.status === PaymentIntentStatus.CONFIRMED ? new Date() : null,
        metadata: { ...(result.metadata ?? {}), authCode: result.authCode ?? null },
      },
    });
    return this.toDto(row);
  }

  async listMpPointTerminals(tenantSlug: string): Promise<PointTerminalInfo[]> {
    const settings = await this.credentials.getOrCreateSettings(tenantSlug);
    if (!settings.mercadoPagoEnabled) {
      throw new BadRequestException('Mercado Pago não está habilitado.');
    }
    const creds = await this.credentials.resolveCredentials(tenantSlug, PaymentPspProvider.MERCADO_PAGO);
    return this.mercadoPago.listPointTerminals(creds);
  }

  async createPointChargeForKiosk(
    tenantSlug: string,
    pdvTerminalId: string,
    input: { amount: number; paymentType: 'credit_card' | 'debit_card'; description?: string },
  ): Promise<PaymentIntentDto> {
    if (input.amount <= 0) throw new BadRequestException('Valor inválido.');
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const terminal = await db.pdvTerminal.findUnique({ where: { id: pdvTerminalId } });
    if (!terminal?.isActive) throw new NotFoundException('Terminal inativo.');
    const mpPointTerminalId = terminal.mpPointTerminalId?.trim();
    if (!mpPointTerminalId) {
      throw new BadRequestException('Este PDV não possui maquininha Point vinculada.');
    }

    const settings = await this.credentials.getOrCreateSettings(tenantSlug);
    if (!settings.mercadoPagoEnabled) {
      throw new BadRequestException('Mercado Pago não está habilitado.');
    }
    const creds = await this.credentials.resolveCredentials(tenantSlug, PaymentPspProvider.MERCADO_PAGO);

    const pending = await db.paymentIntent.findMany({
      where: {
        provider: PaymentPspProvider.MERCADO_PAGO,
        method: PaymentIntentMethod.CARD,
        status: { in: [PaymentIntentStatus.PENDING, PaymentIntentStatus.PROCESSING] },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    for (const p of pending) {
      const meta = p.metadata as { pointTerminalId?: string } | null;
      if (meta?.pointTerminalId === mpPointTerminalId) {
        await this.cancelIntent(tenantSlug, p.id);
      }
    }

    const orderReference = `GV-PT-${randomUUID()}`;
    const result = await this.mercadoPago.createPointOrder(creds, {
      amount: input.amount,
      orderReference,
      terminalId: mpPointTerminalId,
      paymentType: input.paymentType,
      description: input.description,
    });

    const row = await db.paymentIntent.create({
      data: {
        method: PaymentIntentMethod.CARD,
        status: result.status,
        provider: PaymentPspProvider.MERCADO_PAGO,
        amount: String(input.amount.toFixed(2)),
        externalId: result.externalId,
        orderReference,
        confirmedAt: result.status === PaymentIntentStatus.CONFIRMED ? new Date() : null,
        metadata: {
          ...(result.metadata ?? {}),
          authCode: result.authCode ?? null,
          pointTerminalId: mpPointTerminalId,
          paymentType: input.paymentType,
          pdvTerminalId,
        } as Prisma.InputJsonValue,
      },
    });
    return this.toDto(row);
  }

  async getIntent(tenantSlug: string, id: string, refresh = false): Promise<PaymentIntentDto> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    let row = await db.paymentIntent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Cobrança não encontrada.');
    if (
      refresh &&
      row.externalId &&
      row.status !== PaymentIntentStatus.CONFIRMED &&
      row.status !== PaymentIntentStatus.CANCELLED
    ) {
      row = await this.syncIntentStatus(tenantSlug, row.id);
    }
    if (
      row.expiresAt &&
      row.expiresAt < new Date() &&
      row.status !== PaymentIntentStatus.CONFIRMED &&
      row.status !== PaymentIntentStatus.CANCELLED
    ) {
      row = await db.paymentIntent.update({
        where: { id: row.id },
        data: { status: PaymentIntentStatus.EXPIRED },
      });
    }
    return this.toDto(row);
  }

  async cancelIntent(tenantSlug: string, id: string): Promise<PaymentIntentDto> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.paymentIntent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Cobrança não encontrada.');
    if (row.status === PaymentIntentStatus.CONFIRMED) {
      throw new BadRequestException('Cobrança já confirmada.');
    }
    if (row.externalId) {
      const creds = await this.credentials.resolveCredentials(tenantSlug, row.provider);
      const adapter = this.orchestrator.get(row.provider);
      try {
        await adapter.cancelPayment(creds, row.externalId, row.method);
      } catch {
        /* PSP pode não permitir cancelamento */
      }
    }
    const updated = await db.paymentIntent.update({
      where: { id },
      data: { status: PaymentIntentStatus.CANCELLED },
    });
    return this.toDto(updated);
  }

  async syncIntentStatus(tenantSlug: string, intentId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.paymentIntent.findUnique({ where: { id: intentId } });
    if (!row?.externalId) return row!;
    const creds = await this.credentials.resolveCredentials(tenantSlug, row.provider);
    const adapter = this.orchestrator.get(row.provider);
    const statusResult = await adapter.getPaymentStatus(creds, row.externalId, row.method);
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    if (statusResult.authCode) meta.authCode = statusResult.authCode;
    return db.paymentIntent.update({
      where: { id: row.id },
      data: {
        status: statusResult.status,
        confirmedAt:
          statusResult.status === PaymentIntentStatus.CONFIRMED ? new Date() : row.confirmedAt,
        metadata: { ...meta, ...(statusResult.metadata ?? {}) } as Prisma.InputJsonValue,
      },
    });
  }

  async handleWebhook(
    tenantSlug: string,
    providerKey: string,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    query: Record<string, string>,
  ): Promise<void> {
    const provider = providerKey.toUpperCase().replace(/-/g, '_') as PaymentPspProvider;
    if (!Object.values(PaymentPspProvider).includes(provider)) return;
    const creds = await this.credentials.resolveCredentials(tenantSlug, provider);
    const adapter = this.orchestrator.get(provider);
    if (adapter.validateWebhook && !adapter.validateWebhook(creds, headers, body, query)) {
      throw new BadRequestException('Assinatura webhook inválida.');
    }
    const externalId = adapter.extractWebhookExternalId?.(body);
    if (!externalId) return;
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const intent = await db.paymentIntent.findFirst({
      where: { externalId, provider },
      orderBy: { createdAt: 'desc' },
    });
    if (!intent) return;
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: { webhookPayload: body as object },
    });
    await this.syncIntentStatus(tenantSlug, intent.id);
  }

  async assertIntentForSale(
    tenantSlug: string,
    paymentIntentId: string,
    expectedAmount: number,
  ): Promise<{ externalTxnId: string | null; authCode: string | null }> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    let intent = await db.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) throw new BadRequestException('Cobrança de pagamento inválida.');
    if (intent.status !== PaymentIntentStatus.CONFIRMED && intent.externalId) {
      intent = await this.syncIntentStatus(tenantSlug, intent.id);
    }
    if (intent.status !== PaymentIntentStatus.CONFIRMED) {
      throw new BadRequestException('Pagamento ainda não confirmado pelo PSP.');
    }
    const amt = Number(intent.amount);
    if (Math.abs(amt - expectedAmount) > 0.02) {
      throw new BadRequestException('Valor da cobrança não confere com o pagamento.');
    }
    if (intent.saleId) {
      throw new BadRequestException('Esta cobrança já foi vinculada a uma venda.');
    }
    const meta = intent.metadata as { authCode?: string } | null;
    return {
      externalTxnId: intent.externalId,
      authCode: meta?.authCode ?? intent.externalId,
    };
  }

  async linkIntentToSale(tenantSlug: string, paymentIntentId: string, saleId: string): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    await db.paymentIntent.update({
      where: { id: paymentIntentId },
      data: { saleId },
    });
  }
}
