import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantService } from '../tenant/tenant.service';
import { WaChatApiKeyGuard } from './wachat-apikey.guard';
import { WaChatFactoryBotService } from './wachat-factory-bot.service';
import { WhatsappCloudService } from './whatsapp-cloud.service';

/**
 * Webhook Meta WhatsApp Cloud + endpoint de teste inbound.
 * Toda a conversa roda na API GestorVend (sem GestorVendChat externo).
 */
@Controller()
export class WhatsappFactoryWebhookController {
  constructor(
    private readonly bot: WaChatFactoryBotService,
    private readonly whatsapp: WhatsappCloudService,
    private readonly tenants: TenantService,
    private readonly config: ConfigService,
  ) {}

  /** Verificação do webhook Meta (hub.challenge). */
  @Get('webhooks/whatsapp/factory')
  verifyMeta(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const expected =
      this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN')?.trim() || 'gestorvend-factory';
    if (mode === 'subscribe' && verifyToken === expected && challenge) {
      return challenge;
    }
    throw new BadRequestException('Falha na verificação do webhook WhatsApp.');
  }

  /** Eventos de mensagem Meta → FSM → resposta via Graph API. */
  @Post('webhooks/whatsapp/factory')
  @HttpCode(200)
  async metaWebhook(@Body() body: unknown) {
    const messages = this.whatsapp.parseInboundTextMessages(body);
    for (const m of messages) {
      const tenantSlug = await this.tenants.findSlugByFactoryWhatsappPhoneNumberId(
        m.phoneNumberId,
      );
      if (!tenantSlug) continue;
      try {
        const replies = await this.bot.handleInbound(
          tenantSlug,
          m.from,
          m.text,
          m.customerName,
        );
        for (const reply of replies) {
          await this.whatsapp.sendReply(tenantSlug, m.from, reply);
        }
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : 'Serviço temporariamente indisponível.';
        await this.whatsapp.sendText(
          tenantSlug,
          m.from,
          `Não foi possível atender agora (${msg}). Tente mais tarde ou acesse nossa loja online.`,
        );
      }
    }
    return { ok: true };
  }

  /** Teste / integração manual — retorna replies sem enviar ao Meta. */
  @Post('wachat/factory/inbound')
  @UseGuards(WaChatApiKeyGuard)
  async inboundTest(
    @Body()
    body: {
      tenantSlug: string;
      fromPhone: string;
      text: string;
      customerName?: string | null;
    },
  ) {
    if (!body?.tenantSlug?.trim()) throw new BadRequestException('Informe tenantSlug');
    if (!body?.fromPhone?.trim()) throw new BadRequestException('Informe fromPhone');
    const replies = await this.bot.handleInbound(
      body.tenantSlug.trim(),
      body.fromPhone,
      body.text ?? '',
      body.customerName,
    );
    return { replies };
  }

  /** Teste inbound + envio real via Meta (mesma chave da bridge). */
  @Post('wachat/factory/inbound/send')
  @UseGuards(WaChatApiKeyGuard)
  async inboundAndSend(
    @Body()
    body: {
      tenantSlug: string;
      fromPhone: string;
      text: string;
      customerName?: string | null;
    },
  ) {
    const replies = await this.bot.handleInbound(
      body.tenantSlug.trim(),
      body.fromPhone,
      body.text ?? '',
      body.customerName,
    );
    for (const reply of replies) {
      await this.whatsapp.sendReply(body.tenantSlug.trim(), body.fromPhone, reply);
    }
    return { replies, sent: true };
  }
}
