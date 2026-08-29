import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PaymentIntentMethod,
  PaymentPspEnvironment,
  PaymentPspProvider,
} from '../generated/tenant-client';
import { decryptSecret, encryptSecret } from './credential-crypto.util';
import { ProviderCredentials } from './providers/payment-provider.interface';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CompanyService } from '../company/company.service';

export type PaymentSettingsPublic = {
  id: string;
  activeProvider: PaymentPspProvider | null;
  getnetEnabled: boolean;
  mercadoPagoEnabled: boolean;
  environment: PaymentPspEnvironment;
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

export type UpdatePaymentSettingsInput = {
  activeProvider?: PaymentPspProvider | null;
  getnetEnabled?: boolean;
  mercadoPagoEnabled?: boolean;
  environment?: PaymentPspEnvironment;
  pixEnabled?: boolean;
  cardEnabled?: boolean;
  pixTimeoutSeconds?: number;
  pixKeyType?: string | null;
  pixKey?: string | null;
  getnetClientId?: string | null;
  getnetClientSecret?: string | null;
  getnetChannel?: string | null;
  getnetScope?: string | null;
  getnetWebhookUser?: string | null;
  getnetWebhookPassword?: string | null;
  mercadoPagoAccessToken?: string | null;
  mercadoPagoPublicKey?: string | null;
  mercadoPagoWebhookSecret?: string | null;
};

@Injectable()
export class PaymentCredentialsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly company: CompanyService,
  ) {}

  webhookBase(tenantSlug: string): string {
    const base =
      process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
      `http://localhost:${process.env.PORT ?? 3000}/api`;
    return `${base}/webhooks/psp`;
  }

  async getOrCreateSettings(tenantSlug: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const co = await this.company.getOrCreate(tenantSlug);
    let settings = await db.paymentProviderSettings.findUnique({ where: { companyId: co.id } });
    if (!settings) {
      settings = await db.paymentProviderSettings.create({
        data: { companyId: co.id },
      });
    }
    return settings;
  }

  toPublic(tenantSlug: string, settings: Awaited<ReturnType<typeof this.getOrCreateSettings>>): PaymentSettingsPublic {
    const base = this.webhookBase(tenantSlug);
    return {
      id: settings.id,
      activeProvider: settings.activeProvider,
      getnetEnabled: settings.getnetEnabled,
      mercadoPagoEnabled: settings.mercadoPagoEnabled,
      environment: settings.environment,
      pixEnabled: settings.pixEnabled,
      cardEnabled: settings.cardEnabled,
      pixTimeoutSeconds: settings.pixTimeoutSeconds,
      pixKeyType: settings.pixKeyType,
      pixKey: settings.pixKey,
      mercadoPagoPublicKey: settings.mercadoPagoPublicKey,
      hasGetnetCredentials: Boolean(settings.getnetClientIdEnc && settings.getnetClientSecretEnc),
      hasMercadoPagoCredentials: Boolean(settings.mercadoPagoAccessTokenEnc),
      webhookUrls: {
        getnet: `${base}/getnet?tenant=${encodeURIComponent(tenantSlug)}`,
        mercadoPago: `${base}/mercadopago?tenant=${encodeURIComponent(tenantSlug)}`,
      },
    };
  }

  async updateSettings(tenantSlug: string, input: UpdatePaymentSettingsInput) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const current = await this.getOrCreateSettings(tenantSlug);
    const data: Record<string, unknown> = {};

    const assign = <K extends keyof UpdatePaymentSettingsInput>(key: K) => {
      if (input[key] !== undefined) data[key as string] = input[key];
    };

    assign('activeProvider');
    assign('getnetEnabled');
    assign('mercadoPagoEnabled');
    assign('environment');
    assign('pixEnabled');
    assign('cardEnabled');
    if (input.pixTimeoutSeconds !== undefined) {
      data.pixTimeoutSeconds = Math.max(60, Math.min(3600, input.pixTimeoutSeconds));
    }
    assign('pixKeyType');
    assign('pixKey');
    assign('getnetChannel');
    assign('getnetScope');
    assign('getnetWebhookUser');
    assign('mercadoPagoPublicKey');

    if (input.getnetClientId !== undefined) {
      data.getnetClientIdEnc = input.getnetClientId?.trim()
        ? encryptSecret(input.getnetClientId)
        : null;
    }
    if (input.getnetClientSecret !== undefined) {
      data.getnetClientSecretEnc = input.getnetClientSecret?.trim()
        ? encryptSecret(input.getnetClientSecret)
        : null;
    }
    if (input.getnetWebhookPassword !== undefined) {
      data.getnetWebhookPasswordEnc = input.getnetWebhookPassword?.trim()
        ? encryptSecret(input.getnetWebhookPassword)
        : null;
    }
    if (input.mercadoPagoAccessToken !== undefined) {
      data.mercadoPagoAccessTokenEnc = input.mercadoPagoAccessToken?.trim()
        ? encryptSecret(input.mercadoPagoAccessToken)
        : null;
    }
    if (input.mercadoPagoWebhookSecret !== undefined) {
      data.mercadoPagoWebhookSecretEnc = input.mercadoPagoWebhookSecret?.trim()
        ? encryptSecret(input.mercadoPagoWebhookSecret)
        : null;
    }

    const updated = await db.paymentProviderSettings.update({
      where: { id: current.id },
      data,
    });
    return this.toPublic(tenantSlug, updated);
  }

  async resolveCredentials(tenantSlug: string, provider: PaymentPspProvider): Promise<ProviderCredentials> {
    const settings = await this.getOrCreateSettings(tenantSlug);
    if (provider === PaymentPspProvider.GETNET) {
      if (!settings.getnetEnabled) {
        throw new BadRequestException('Getnet não está habilitada para esta empresa.');
      }
      const clientId = decryptSecret(settings.getnetClientIdEnc);
      const clientSecret = decryptSecret(settings.getnetClientSecretEnc);
      if (!clientId || !clientSecret) {
        throw new BadRequestException('Credenciais Getnet não configuradas.');
      }
      return {
        provider,
        environment: settings.environment,
        pixTimeoutSeconds: settings.pixTimeoutSeconds,
        pixKey: settings.pixKey ?? undefined,
        pixKeyType: settings.pixKeyType ?? undefined,
        getnet: {
          clientId,
          clientSecret,
          channel: settings.getnetChannel ?? undefined,
          scope: settings.getnetScope ?? 'oob',
          webhookUser: settings.getnetWebhookUser ?? undefined,
          webhookPassword: decryptSecret(settings.getnetWebhookPasswordEnc) || undefined,
        },
      };
    }
    if (provider === PaymentPspProvider.MERCADO_PAGO) {
      if (!settings.mercadoPagoEnabled) {
        throw new BadRequestException('Mercado Pago não está habilitado para esta empresa.');
      }
      const accessToken = decryptSecret(settings.mercadoPagoAccessTokenEnc);
      if (!accessToken) {
        throw new BadRequestException('Access Token do Mercado Pago não configurado.');
      }
      return {
        provider,
        environment: settings.environment,
        pixTimeoutSeconds: settings.pixTimeoutSeconds,
        pixKey: settings.pixKey ?? undefined,
        pixKeyType: settings.pixKeyType ?? undefined,
        mercadoPago: {
          accessToken,
          publicKey: settings.mercadoPagoPublicKey ?? undefined,
          webhookSecret: decryptSecret(settings.mercadoPagoWebhookSecretEnc) || undefined,
        },
      };
    }
    throw new BadRequestException('Provedor de pagamento inválido.');
  }

  async resolveActiveProvider(tenantSlug: string, preferred?: PaymentPspProvider): Promise<PaymentPspProvider> {
    const settings = await this.getOrCreateSettings(tenantSlug);
    if (preferred) return preferred;
    if (settings.activeProvider) return settings.activeProvider;
    if (settings.mercadoPagoEnabled) return PaymentPspProvider.MERCADO_PAGO;
    if (settings.getnetEnabled) return PaymentPspProvider.GETNET;
    throw new BadRequestException('Nenhum provedor de pagamento ativo. Configure em Pagamentos.');
  }
}

