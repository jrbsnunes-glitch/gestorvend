import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { PlanGuard } from '../auth/guards/plan.guard';
import { RequiresPlan } from '../auth/plan.decorator';
import { PlanCode } from '../generated/central-client';
import { PaymentMethod as TenantPaymentMethod } from '../generated/tenant-client';
import { WaChatApiKeyGuard } from './wachat-apikey.guard';
import { WaChatService } from './wachat.service';

type CreateOrderBody = {
  tenantSlug: string;
  customerPhone?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerDocument?: string | null;
  items: Array<{ variantId?: string; sku?: string; quantity: number; unitPrice: number }>;
  paymentMethod: TenantPaymentMethod | string;
  totalValue: number;
  deliveryAddress?: string | null;
  notes?: string | null;
  externalRef: string;
};

/**
 * Bridge HTTP consumida pelo GestorVendChat (FastAPI) para:
 *  - ler o catálogo/estoque do tenant
 *  - registrar pedidos confirmados no WhatsApp como Sale do GestorVend
 *
 * Autenticação: header `X-WaChat-Key` (segredo `WACHAT_API_KEY`).
 * Autorização: plano `WHATSAPP` no tenant.
 */
@Controller('wachat')
@UseGuards(WaChatApiKeyGuard, PlanGuard)
@RequiresPlan(PlanCode.WHATSAPP)
export class WaChatController {
  constructor(private readonly wachat: WaChatService) {}

  @Get('catalog')
  catalog(@Query('tenantSlug') tenantSlug: string) {
    if (!tenantSlug) throw new BadRequestException('Informe tenantSlug');
    return this.wachat.getCatalog(tenantSlug);
  }

  @Post('orders')
  @HttpCode(201)
  createOrder(@Body() body: CreateOrderBody) {
    if (!body?.tenantSlug) throw new BadRequestException('Informe tenantSlug');
    const method = this.normalizePaymentMethod(body.paymentMethod);
    return this.wachat.createOrder({
      tenantSlug: body.tenantSlug,
      customerPhone: body.customerPhone ?? null,
      customerName: body.customerName ?? null,
      customerEmail: body.customerEmail ?? null,
      customerDocument: body.customerDocument ?? null,
      items: body.items,
      paymentMethod: method,
      totalValue: body.totalValue,
      deliveryAddress: body.deliveryAddress ?? null,
      notes: body.notes ?? null,
      externalRef: body.externalRef,
    });
  }

  private normalizePaymentMethod(input: string | TenantPaymentMethod): TenantPaymentMethod {
    const v = String(input || '').toUpperCase();
    switch (v) {
      case 'PIX':
        return 'PIX';
      case 'CARD':
      case 'CARTAO':
      case 'CARTAO_CREDITO':
      case 'CREDIT_CARD':
        return 'CARD';
      case 'CASH':
      case 'DINHEIRO':
        return 'CASH';
      case 'CREDIT':
      case 'CREDIARIO':
        return 'CREDIT';
      default:
        return 'OTHER';
    }
  }
}
