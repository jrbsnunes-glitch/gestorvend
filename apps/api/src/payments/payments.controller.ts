import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PaymentPspProvider } from '../generated/tenant-client';
import { PaymentCredentialsService } from './payment-credentials.service';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly credentials: PaymentCredentialsService,
  ) {}

  @Get('settings')
  @Roles('admin', 'manager')
  async getSettings(@CurrentUser() user: JwtPayload) {
    const settings = await this.credentials.getOrCreateSettings(user.tenantSlug);
    return this.credentials.toPublic(user.tenantSlug, settings);
  }

  @Post('settings')
  @Roles('admin', 'manager')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    return this.credentials.updateSettings(user.tenantSlug, body as Parameters<
      PaymentCredentialsService['updateSettings']
    >[1]);
  }

  /** Config pública para PDV (Public Key MP, flags). */
  @Get('settings/pdv')
  @Roles('admin', 'manager', 'seller')
  async getPdvSettings(@CurrentUser() user: JwtPayload) {
    const settings = await this.credentials.getOrCreateSettings(user.tenantSlug);
    const pub = this.credentials.toPublic(user.tenantSlug, settings);
    const visibleProviders = [
      ...(pub.getnetEnabled && pub.hasGetnetCredentials ? (['GETNET'] as const) : []),
      ...(pub.mercadoPagoEnabled && pub.hasMercadoPagoCredentials
        ? (['MERCADO_PAGO'] as const)
        : []),
    ];
    return {
      activeProvider: pub.activeProvider,
      visibleProviders,
      getnetEnabled: pub.getnetEnabled,
      mercadoPagoEnabled: pub.mercadoPagoEnabled,
      pixEnabled: pub.pixEnabled,
      cardEnabled: pub.cardEnabled,
      mercadoPagoPublicKey: pub.mercadoPagoPublicKey,
      hasOnlinePix: pub.pixEnabled && visibleProviders.length > 0,
      hasOnlineCard: pub.cardEnabled && visibleProviders.length > 0,
    };
  }

  @Post('pix/charges')
  @Roles('admin', 'manager', 'seller')
  createPix(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      amount: number;
      description?: string;
      payerEmail?: string;
      provider?: PaymentPspProvider;
    },
  ) {
    return this.payments.createPixCharge(user.tenantSlug, body);
  }

  @Post('card/charges')
  @Roles('admin', 'manager', 'seller')
  createCard(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      amount: number;
      payerEmail: string;
      payerDocument?: string;
      provider?: PaymentPspProvider;
      installments?: number;
      cardToken?: string;
      paymentMethodId?: string;
      paymentMethodType?: 'credit_card' | 'debit_card';
      getnetCardId?: string;
      getnetCard?: {
        number: string;
        holder: string;
        expirationDate: string;
        cvv: string;
      };
    },
  ) {
    return this.payments.createCardCharge(user.tenantSlug, body);
  }

  @Get('intents/:id')
  @Roles('admin', 'manager', 'seller')
  getIntent(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.payments.getIntent(user.tenantSlug, id, refresh === '1' || refresh === 'true');
  }

  @Delete('intents/:id')
  @Roles('admin', 'manager', 'seller')
  cancelIntent(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.payments.cancelIntent(user.tenantSlug, id);
  }

  @Get('mp-point/terminals')
  @Roles('admin', 'manager')
  listMpPointTerminals(@CurrentUser() user: JwtPayload) {
    return this.payments.listMpPointTerminals(user.tenantSlug);
  }
}
