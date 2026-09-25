import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { WaChatBotReply } from './wachat-bot-reply.types';

@Injectable()
export class WhatsappCloudService {
  private readonly log = new Logger(WhatsappCloudService.name);

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async sendText(tenantSlug: string, toPhone: string, body: string): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const co = await db.company.findFirst({
      select: {
        factoryWhatsappPhoneNumberId: true,
        factoryWhatsappAccessToken: true,
        factoryWhatsappBotEnabled: true,
      },
    });
    if (!co?.factoryWhatsappBotEnabled) return;
    const token = co.factoryWhatsappAccessToken?.trim();
    const phoneNumberId = co.factoryWhatsappPhoneNumberId?.trim();
    if (!token || !phoneNumberId) {
      this.log.warn(`WhatsApp não configurado para tenant ${tenantSlug}`);
      return;
    }

    const to = toPhone.replace(/\D/g, '');
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      this.log.error(`Meta API ${res.status}: ${errText}`);
    }
  }

  async sendImage(
    tenantSlug: string,
    toPhone: string,
    imageUrl: string,
    caption?: string,
  ): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const co = await db.company.findFirst({
      select: {
        factoryWhatsappPhoneNumberId: true,
        factoryWhatsappAccessToken: true,
        factoryWhatsappBotEnabled: true,
      },
    });
    if (!co?.factoryWhatsappBotEnabled) return;
    const token = co.factoryWhatsappAccessToken?.trim();
    const phoneNumberId = co.factoryWhatsappPhoneNumberId?.trim();
    if (!token || !phoneNumberId) {
      this.log.warn(`WhatsApp não configurado para tenant ${tenantSlug}`);
      return;
    }

    const to = toPhone.replace(/\D/g, '');
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const image: Record<string, string> = { link: imageUrl };
    if (caption?.trim()) image.caption = caption.trim().slice(0, 1024);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      this.log.error(`Meta API image ${res.status}: ${errText}`);
    }
  }

  async sendReply(tenantSlug: string, toPhone: string, reply: WaChatBotReply): Promise<void> {
    if (reply.type === 'text') {
      await this.sendText(tenantSlug, toPhone, reply.body);
      return;
    }
    await this.sendImage(tenantSlug, toPhone, reply.url, reply.caption);
  }

  /** Extrai mensagens de texto do payload webhook Meta (Cloud API). */
  parseInboundTextMessages(payload: unknown): Array<{
    phoneNumberId: string;
    from: string;
    text: string;
    customerName: string;
  }> {
    const out: Array<{
      phoneNumberId: string;
      from: string;
      text: string;
      customerName: string;
    }> = [];
    if (!payload || typeof payload !== 'object') return out;
    const root = payload as Record<string, unknown>;
    const entries = Array.isArray(root.entry) ? root.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray((entry as any).changes) ? (entry as any).changes : [];
      for (const change of changes) {
        const value = change?.value;
        if (!value || typeof value !== 'object') continue;
        const phoneNumberId = String((value as any).metadata?.phone_number_id ?? '');
        const contacts = Array.isArray((value as any).contacts) ? (value as any).contacts : [];
        const name =
          (contacts[0]?.profile?.name as string | undefined)?.trim() ?? '';
        const messages = Array.isArray((value as any).messages) ? (value as any).messages : [];
        for (const m of messages) {
          if (m?.type !== 'text') continue;
          const text = m?.text?.body;
          const from = m?.from;
          if (typeof text === 'string' && typeof from === 'string' && phoneNumberId) {
            out.push({ phoneNumberId, from, text, customerName: name });
          }
        }
      }
    }
    return out;
  }
}
