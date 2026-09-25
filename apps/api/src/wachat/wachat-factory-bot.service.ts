import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductImageStorage } from '../catalog/product-image.storage';
import { PlanCode, TenantModuleAddon } from '../generated/central-client';
import { TenantService } from '../tenant/tenant.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { WaChatBotReply } from './wachat-bot-reply.types';
import {
  applyMessageTemplate,
  DEFAULT_FACTORY_WA_HANDOFF,
  DEFAULT_FACTORY_WA_MENU,
  DEFAULT_FACTORY_WA_WELCOME,
} from './wachat-factory-copy';
import { WaChatFactoryService } from './wachat-factory.service';

export type { WaChatBotReply } from './wachat-bot-reply.types';

type BotState =
  | 'idle'
  | 'menu'
  | 'catalog_page'
  | 'await_qty'
  | 'await_notes'
  | 'confirm'
  | 'done';

type CatalogProduct = {
  listIndex: number;
  productId: string;
  name: string;
  description: string | null;
  controlNumber: number;
  variantId: string;
  retailPrice: string;
  leadTimeDays: number | null;
  hasImage: boolean;
  imageVersion: number;
};

type BotCopy = {
  welcome: string;
  menu: string;
  handoff: string;
};

type Session = {
  tenantSlug: string;
  phone: string;
  state: BotState;
  updatedAt: number;
  catalog: CatalogProduct[];
  page: number;
  selected: CatalogProduct | null;
  quantity: string;
  notes: string;
  externalRef: string;
  customerName: string;
};

const PAGE_SIZE = 8;
const SESSION_TTL_MS = 48 * 3600 * 1000;

@Injectable()
export class WaChatFactoryBotService {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly factory: WaChatFactoryService,
    private readonly tenants: TenantService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly config: ConfigService,
    private readonly productImages: ProductImageStorage,
  ) {}

  private sessionKey(tenantSlug: string, phone: string) {
    const digits = phone.replace(/\D/g, '');
    return `${tenantSlug}:${digits}`;
  }

  private storeBaseUrl() {
    return (
      this.config.get<string>('PUBLIC_WEB_BASE_URL')?.trim() ||
      this.config.get<string>('WEB_PUBLIC_URL')?.trim() ||
      'http://127.0.0.1:5173'
    ).replace(/\/$/, '');
  }

  private apiPublicBaseUrl() {
    const raw =
      this.config.get<string>('PUBLIC_API_BASE_URL')?.trim() ||
      this.config.get<string>('API_PUBLIC_URL')?.trim() ||
      '';
    if (raw) return raw.replace(/\/$/, '');
    return '';
  }

  private productImageAbsoluteUrl(
    tenantSlug: string,
    productId: string,
    imageVersion: number,
  ): string | null {
    const rel = this.productImages.publicUrl(tenantSlug, productId, 'medium', imageVersion);
    const base = this.apiPublicBaseUrl();
    if (!base) return null;
    return `${base}${rel.startsWith('/') ? rel : `/${rel}`}`;
  }

  private getSession(tenantSlug: string, phone: string): Session {
    const key = this.sessionKey(tenantSlug, phone);
    let s = this.sessions.get(key);
    if (s && Date.now() - s.updatedAt > SESSION_TTL_MS) {
      this.sessions.delete(key);
      s = undefined;
    }
    if (!s) {
      s = {
        tenantSlug,
        phone,
        state: 'idle',
        updatedAt: Date.now(),
        catalog: [],
        page: 0,
        selected: null,
        quantity: '1',
        notes: '',
        externalRef: '',
        customerName: '',
      };
      this.sessions.set(key, s);
    }
    s.updatedAt = Date.now();
    return s;
  }

  private norm(text: string) {
    return text.trim().toLowerCase();
  }

  private texts(...bodies: string[]): WaChatBotReply[] {
    return bodies.map((body) => ({ type: 'text' as const, body }));
  }

  private formatPrice(raw: string | null | undefined): string {
    if (!raw) return 'sob consulta';
    const v = parseFloat(String(raw).replace(',', '.'));
    if (!Number.isFinite(v)) return 'sob consulta';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  private productLine(p: CatalogProduct): string {
    const lead = p.leadTimeDays ? ` · prazo ${p.leadTimeDays} dias` : '';
    return `${p.listIndex}. #${p.controlNumber} ${p.name} — ${this.formatPrice(p.retailPrice)}${lead}`;
  }

  private async loadBotCopy(tenantSlug: string): Promise<BotCopy> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const co = await db.company.findFirst({
      select: {
        factoryWhatsappWelcomeText: true,
        factoryWhatsappMenuText: true,
        factoryWhatsappHandoffText: true,
      },
    });
    return {
      welcome: co?.factoryWhatsappWelcomeText?.trim() || DEFAULT_FACTORY_WA_WELCOME,
      menu: co?.factoryWhatsappMenuText?.trim() || DEFAULT_FACTORY_WA_MENU,
      handoff: co?.factoryWhatsappHandoffText?.trim() || DEFAULT_FACTORY_WA_HANDOFF,
    };
  }

  async assertBotEnabled(tenantSlug: string) {
    await this.tenants.assertPlan(tenantSlug, [PlanCode.WHATSAPP]);
    await this.tenants.assertModule(tenantSlug, TenantModuleAddon.FACTORY);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const co = await db.company.findFirst({
      select: { factoryModuleEnabled: true, factoryWhatsappBotEnabled: true },
    });
    if (!co?.factoryModuleEnabled) {
      throw new BadRequestException('Módulo Fábrica desativado.');
    }
    if (!co.factoryWhatsappBotEnabled) {
      throw new BadRequestException('Bot WhatsApp da Fábrica desativado na Empresa.');
    }
  }

  /**
   * Processa mensagem inbound e devolve respostas (texto e/ou imagem).
   */
  async handleInbound(
    tenantSlug: string,
    fromPhone: string,
    text: string,
    customerName?: string | null,
  ): Promise<WaChatBotReply[]> {
    await this.assertBotEnabled(tenantSlug);
    const copy = await this.loadBotCopy(tenantSlug);
    const s = this.getSession(tenantSlug, fromPhone);
    if (customerName?.trim()) s.customerName = customerName.trim();

    const msg = this.norm(text);
    if (
      ['menu', 'inicio', 'início', 'oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'].includes(
        msg,
      )
    ) {
      s.state = 'menu';
      return this.texts(copy.menu);
    }

    if (s.state === 'idle') {
      s.state = 'menu';
      return this.texts(copy.welcome, copy.menu);
    }

    if (s.state === 'menu') return this.handleMenu(s, msg, copy);
    if (s.state === 'catalog_page') return this.handleCatalogPage(s, msg, text.trim(), copy);
    if (s.state === 'await_qty') return this.handleQty(s, text.trim());
    if (s.state === 'await_notes') return this.handleNotes(s, text.trim());
    if (s.state === 'confirm') return this.handleConfirm(s, msg, copy);
    if (s.state === 'done') {
      return this.texts(
        'Seu pedido de orçamento já foi registrado. Digite *menu* para outra consulta ou aguarde nosso consultor.',
      );
    }

    s.state = 'menu';
    return this.texts(copy.menu);
  }

  private async handleMenu(s: Session, msg: string, copy: BotCopy): Promise<WaChatBotReply[]> {
    if (['1', 'catalogo', 'catálogo', 'ver catalogo', 'ver catálogo'].includes(msg)) {
      return this.showCatalogPage(s, 0, copy);
    }
    if (['2', 'atendente', 'humano'].includes(msg)) {
      s.state = 'done';
      return this.texts(
        'Certo! Um consultor humano dará continuidade por aqui em breve. ' +
          'Se preferir, acesse nossa loja online.',
      );
    }
    return this.texts('Opção inválida.', copy.menu);
  }

  private async showCatalogPage(
    s: Session,
    page: number,
    copy: BotCopy,
  ): Promise<WaChatBotReply[]> {
    try {
      const data = await this.factory.getCatalog(s.tenantSlug);
      const products = (data.products ?? []) as CatalogProduct[];
      s.catalog = products;
      s.page = page;
      s.state = 'catalog_page';

      if (!products.length) {
        s.state = 'menu';
        return this.texts('Nenhum produto disponível no catálogo no momento.', copy.menu);
      }

      const start = page * PAGE_SIZE;
      const chunk = products.slice(start, start + PAGE_SIZE);
      const lines = chunk.map((p) => this.productLine(p));
      const nav: string[] = [];
      if (start + PAGE_SIZE < products.length) nav.push('Envie *mais* para ver a próxima página.');
      if (page > 0) nav.push('Envie *voltar* para a página anterior.');
      return this.texts(
        '*Catálogo — produtos sob encomenda*',
        ...lines,
        'Responda com o *número da lista* ou com o *código* do produto (#) para escolher.',
        ...nav,
      );
    } catch {
      s.state = 'menu';
      const url = `${this.storeBaseUrl()}/loja/${encodeURIComponent(s.tenantSlug)}`;
      return this.texts(`Não consegui carregar o catálogo agora. Tente: ${url}`, copy.menu);
    }
  }

  private async handleCatalogPage(
    s: Session,
    msg: string,
    raw: string,
    copy: BotCopy,
  ): Promise<WaChatBotReply[]> {
    if (msg === 'mais') return this.showCatalogPage(s, s.page + 1, copy);
    if (msg === 'voltar') return this.showCatalogPage(s, Math.max(0, s.page - 1), copy);

    let chosen: CatalogProduct | null = null;
    if (/^\d+$/.test(msg)) {
      const n = parseInt(msg, 10);
      chosen = s.catalog.find((p) => p.listIndex === n) ?? null;
    } else {
      const m = raw.match(/#?\s*(\d+)/);
      if (m) {
        const code = parseInt(m[1]!, 10);
        chosen = s.catalog.find((p) => p.controlNumber === code) ?? null;
      }
    }

    if (!chosen) {
      return this.texts(
        'Não encontrei esse item. Use o número da lista ou o código # do produto.',
        'Ou *menu* para recomeçar.',
      );
    }

    s.selected = chosen;
    s.state = 'await_qty';

    const replies: WaChatBotReply[] = [];
    if (chosen.hasImage && chosen.productId) {
      const url = this.productImageAbsoluteUrl(
        s.tenantSlug,
        chosen.productId,
        chosen.imageVersion ?? 0,
      );
      if (url) {
        replies.push({ type: 'image', url, caption: chosen.name });
      }
    }

    let body = `Você escolheu: *${chosen.name}* (#${chosen.controlNumber}).`;
    const desc = chosen.description?.trim();
    if (desc) {
      body += `\n\n${desc.length > 500 ? `${desc.slice(0, 497)}…` : desc}`;
    }
    body += '\n\nQual a *quantidade* desejada? (ex.: 1 ou 2,5)';
    replies.push({ type: 'text', body });
    return replies;
  }

  private handleQty(s: Session, raw: string): WaChatBotReply[] {
    const q = raw.replace(',', '.');
    const n = parseFloat(q);
    if (!Number.isFinite(n) || n <= 0) {
      return this.texts('Quantidade inválida. Informe um número maior que zero.');
    }
    s.quantity = raw.trim();
    s.state = 'await_notes';
    return this.texts(
      'Deseja acrescentar alguma observação? (medidas, cor, prazo…)',
      'Se não, responda *não* ou *-*.',
    );
  }

  private handleNotes(s: Session, raw: string): WaChatBotReply[] {
    const low = this.norm(raw);
    if (!['nao', 'não', '-', 'n', 'ok', 'nenhuma', 'nenhum'].includes(low)) {
      s.notes = raw.trim();
    } else {
      s.notes = '';
    }
    s.state = 'confirm';
    const p = s.selected!;
    const refSuffix = s.phone.replace(/\D/g, '').slice(-10);
    s.externalRef = `wa:${s.tenantSlug}:${refSuffix}:${p.variantId}:${s.quantity}`;
    let summary =
      `*Confirme seu pedido de orçamento:*\n` +
      `Produto: ${p.name} (#${p.controlNumber})\n` +
      `Quantidade: ${s.quantity}\n`;
    if (s.notes) summary += `Obs.: ${s.notes}\n`;
    summary += '\n1 — Confirmar\n2 — Cancelar e voltar ao menu';
    return this.texts(summary);
  }

  private async handleConfirm(
    s: Session,
    msg: string,
    copy: BotCopy,
  ): Promise<WaChatBotReply[]> {
    if (['2', 'cancelar', 'voltar'].includes(msg)) {
      s.state = 'menu';
      s.selected = null;
      return this.texts('Pedido cancelado.', copy.menu);
    }
    if (!['1', 'sim', 'confirmar', 'ok'].includes(msg)) {
      return this.texts('Responda *1* para confirmar ou *2* para cancelar.');
    }

    const p = s.selected;
    if (!p?.variantId) {
      s.state = 'menu';
      return this.texts('Sessão expirada. Escolha o produto novamente.', copy.menu);
    }

    try {
      const result = await this.factory.createLead({
        tenantSlug: s.tenantSlug,
        customerPhone: s.phone,
        customerName: s.customerName || null,
        finishedVariantId: p.variantId,
        quantity: s.quantity,
        notes: s.notes || null,
        externalRef: s.externalRef,
      });
      s.state = 'done';
      const handoff = applyMessageTemplate(copy.handoff, { numero: result.number });
      return this.texts(handoff);
    } catch {
      s.state = 'menu';
      return this.texts(
        'Não foi possível registrar seu pedido agora. Tente novamente em instantes ou digite *menu*.',
      );
    }
  }
}
