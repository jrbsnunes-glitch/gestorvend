import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PlanCode, TenantModuleAddon } from '../generated/central-client';
import {
  DeliveryOrderStatus,
  DeliveryPaymentMode,
  DeliveryPrintMode,
  DeliveryPrintStatus,
  DeliveryStockMode,
  PaymentIntentStatus,
  SaleSource,
  ServiceTabFulfillment,
  ServiceTabItemStatus,
  ServiceTabStatus,
} from '../generated/tenant-client';
import { CompanyService } from '../company/company.service';
import { PaymentCredentialsService } from '../payments/payment-credentials.service';
import { PaymentsService } from '../payments/payments.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { SalesService } from '../sales/sales.service';
import { TenantService } from '../tenant/tenant.service';
import {
  assertDeliveryDistrictAllowed,
  buildPublicDistrictPolicy,
  formatDeliveryAddress,
} from './delivery-districts';
import { isDeliveryOpenNow, parseDeliveryHours } from './delivery-hours';
import { resolveTenant } from './resolve-tenant';
import type { CreateDeliveryOrderDto } from './delivery-public.dto';

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseQty(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? nFrom(v) : nFrom(parseFloat(String(v).replace(',', '.')));
  return Number.isFinite(n) ? n : 0;
}

function nFrom(n: number): number {
  return n;
}

function digitsPhone(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 32);
}

type TenantDb = Awaited<ReturnType<TenantPrismaService['getClient']>>;

const orderInclude = {
  items: {
    where: { status: { not: ServiceTabItemStatus.CANCELLED } },
    include: {
      variant: {
        include: { product: { select: { id: true, name: true, taxUnit: true, hasImage: true, imageVersion: true } } },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  customer: { select: { id: true, name: true, phone: true } },
} as const;

@Injectable()
export class DeliveryService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tenants: TenantService,
    private readonly company: CompanyService,
    private readonly sales: SalesService,
    private readonly restaurant: RestaurantService,
    private readonly payments: PaymentsService,
    private readonly credentials: PaymentCredentialsService,
  ) {}

  async resolveSlug(slugOuHost: string): Promise<string> {
    return resolveTenant(this.tenants, slugOuHost);
  }

  /**
   * Licença + flags. Em rotas públicas vira 404 para não vazar o slug.
   */
  async assertDeliveryEnabled(tenantSlug: string, opts?: { public?: boolean }): Promise<void> {
    const fail = (staffMsg: string): never => {
      if (opts?.public) throw new NotFoundException();
      throw new ForbiddenException(staffMsg);
    };
    try {
      await this.tenants.assertPlan(tenantSlug, [PlanCode.RESTAURANT]);
      await this.tenants.assertModule(tenantSlug, TenantModuleAddon.DELIVERY);
    } catch {
      fail('Delivery não contratado. Ative o adicional no portal (plano Restaurante).');
    }
    const co = await this.company.getOrCreate(tenantSlug);
    if (!co.restaurantModuleEnabled) {
      fail('Módulo restaurante desativado na empresa.');
    }
    if (!co.deliveryEnabled) {
      fail('Canal delivery desativado. Ative em Empresa → Restaurante.');
    }
  }

  private async db(tenantSlug: string, opts?: { public?: boolean }): Promise<TenantDb> {
    await this.assertDeliveryEnabled(tenantSlug, opts);
    return this.tenantPrisma.getClient(tenantSlug);
  }

  private async pixOnlineReady(tenantSlug: string): Promise<boolean> {
    try {
      const settings = await this.credentials.getOrCreateSettings(tenantSlug);
      if (!settings.pixEnabled || !settings.mercadoPagoEnabled) return false;
      const provider = await this.credentials.resolveActiveProvider(tenantSlug);
      await this.credentials.resolveCredentials(tenantSlug, provider);
      return true;
    } catch {
      return false;
    }
  }

  async publicStore(slugOuHost: string) {
    const tenantSlug = await this.resolveSlug(slugOuHost);
    const db = await this.db(tenantSlug, { public: true });
    const co = await db.company.findFirst();
    if (!co) throw new NotFoundException();
    const hours = parseDeliveryHours(co.deliveryHoursJson);
    const isOpen = isDeliveryOpenNow(hours, co.timezone);
    const pixOnline = Boolean(co.deliveryPayPixOnline) && (await this.pixOnlineReady(tenantSlug));
    return {
      slug: tenantSlug,
      tradeName: co.tradeName,
      legalName: co.legalName,
      logoUrl: co.logoUrl,
      phone: co.phone,
      city: co.city,
      state: co.state,
      isOpen,
      hours,
      deliveryFeeEnabled: Boolean(co.deliveryFeeEnabled),
      deliveryFeeValue: money(Number(co.deliveryFeeValue ?? 0)),
      payments: {
        pickup: Boolean(co.deliveryPayPickup),
        pixDeliverer: Boolean(co.deliveryPayPixDeliverer),
        pixOnline,
      },
      districtPolicy: buildPublicDistrictPolicy(co),
    };
  }

  async publicMenu(slugOuHost: string) {
    const tenantSlug = await this.resolveSlug(slugOuHost);
    const db = await this.db(tenantSlug, { public: true });
    const products = await db.product.findMany({
      where: { isActive: true, availableForDelivery: true },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        hasImage: true,
        imageVersion: true,
        category: { select: { id: true, name: true } },
        variants: {
          orderBy: { sku: 'asc' },
          take: 1,
          select: {
            id: true,
            sku: true,
            retailPrice: true,
            promoPrice: true,
          },
        },
      },
    });
    const groups = new Map<
      string,
      { id: string | null; name: string; products: Array<Record<string, unknown>> }
    >();
    for (const p of products) {
      const variant = p.variants[0];
      if (!variant) continue;
      const catId = p.category?.id ?? '_';
      const catName = p.category?.name ?? 'Cardápio';
      let g = groups.get(catId);
      if (!g) {
        g = { id: p.category?.id ?? null, name: catName, products: [] };
        groups.set(catId, g);
      }
      const price = Number(variant.promoPrice ?? variant.retailPrice);
      g.products.push({
        id: p.id,
        name: p.name,
        description: p.description,
        hasImage: p.hasImage,
        imageUrl: p.hasImage
          ? `/api/catalog/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(p.id)}/image?size=medium&v=${p.imageVersion ?? 0}`
          : null,
        variantId: variant.id,
        price: money(price),
      });
    }
    return { categories: [...groups.values()] };
  }

  private async systemUserId(db: TenantDb): Promise<string> {
    const u = await db.user.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!u) throw new BadRequestException('Estabelecimento sem usuário para registrar o pedido.');
    return u.id;
  }

  private itemSignature(
    items: Array<{ variantId: string; quantity: number }>,
  ): string {
    const norm = [...items]
      .map((i) => `${i.variantId}:${i.quantity.toFixed(3)}`)
      .sort()
      .join('|');
    return createHash('sha256').update(norm).digest('hex').slice(0, 24);
  }

  async createPublicOrder(
    slugOuHost: string,
    body: CreateDeliveryOrderDto,
    idempotencyKey?: string | null,
  ) {
    const tenantSlug = await this.resolveSlug(slugOuHost);
    const db = await this.db(tenantSlug, { public: true });
    const co = await db.company.findFirst();
    if (!co) throw new NotFoundException();
    const hours = parseDeliveryHours(co.deliveryHoursJson);
    if (!isDeliveryOpenNow(hours, co.timezone)) {
      throw new BadRequestException('O restaurante está fechado para pedidos no momento.');
    }

    const fulfillment =
      body.fulfillment === 'PICKUP' ? ServiceTabFulfillment.PICKUP : ServiceTabFulfillment.DELIVERY;
    const customerName = String(body.customerName ?? '').trim().slice(0, 120);
    const phone = digitsPhone(body.phone);
    if (customerName.length < 2) throw new BadRequestException('Informe o nome.');
    if (phone.length < 8) throw new BadRequestException('Informe um telefone válido.');

    const addrFields = body.addressFields ?? null;
    let address = String(body.address ?? '').trim().slice(0, 240);
    if (addrFields) {
      const built = formatDeliveryAddress({
        street: addrFields.street,
        number: addrFields.number,
        complement: addrFields.complement,
        district: addrFields.district,
        city: addrFields.city ?? co.city,
      });
      if (built.length >= 8) address = built;
    }
    const districtForPolicy = String(addrFields?.district ?? '').trim();
    if (fulfillment === ServiceTabFulfillment.DELIVERY) {
      if (address.length < 8) {
        throw new BadRequestException('Informe o endereço de entrega.');
      }
      assertDeliveryDistrictAllowed(co, districtForPolicy);
    }

    const saveCustomerData = Boolean(body.saveCustomerData);

    const pixReady = await this.pixOnlineReady(tenantSlug);
    if (body.paymentMode === 'PICKUP' && !co.deliveryPayPickup) {
      throw new BadRequestException('Pagamento na retirada não está disponível.');
    }
    if (body.paymentMode === 'PIX_DELIVERER' && !co.deliveryPayPixDeliverer) {
      throw new BadRequestException('PIX ao entregador não está disponível.');
    }
    if (body.paymentMode === 'PIX_ONLINE' && (!co.deliveryPayPixOnline || !pixReady)) {
      throw new BadRequestException('PIX online não está disponível.');
    }

    const paymentMode =
      body.paymentMode === 'PIX_ONLINE'
        ? DeliveryPaymentMode.PIX_ONLINE
        : body.paymentMode === 'PIX_DELIVERER'
          ? DeliveryPaymentMode.PIX_DELIVERER
          : DeliveryPaymentMode.PICKUP;

    const lines: Array<{ variantId: string; quantity: number; notes: string | null; unitPrice: number }> =
      [];
    for (const raw of body.items ?? []) {
      const qty = parseQty(raw.quantity ?? 1);
      if (qty <= 0) throw new BadRequestException('Quantidade inválida.');
      const variant = await db.productVariant.findUnique({
        where: { id: String(raw.variantId ?? '') },
        include: { product: true },
      });
      if (!variant || !variant.product.isActive || !variant.product.availableForDelivery) {
        throw new BadRequestException('Item indisponível no cardápio.');
      }
      const unitPrice = Number(variant.promoPrice ?? variant.retailPrice);
      lines.push({
        variantId: variant.id,
        quantity: qty,
        notes: raw.notes?.trim()?.slice(0, 180) || null,
        unitPrice,
      });
    }
    if (!lines.length) throw new BadRequestException('Carrinho vazio.');

    const subtotal = money(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const fee =
      fulfillment === ServiceTabFulfillment.DELIVERY && co.deliveryFeeEnabled
        ? money(Number(co.deliveryFeeValue ?? 0))
        : 0;
    const total = money(subtotal + fee);

    const sig = this.itemSignature(lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })));
    const idem = (idempotencyKey?.trim() || `${phone}:${sig}`).slice(0, 80);
    const recent = await db.serviceTab.findFirst({
      where: {
        fulfillment,
        deliveryPhone: phone,
        status: ServiceTabStatus.OPEN,
        createdAt: { gte: new Date(Date.now() - 90_000) },
      },
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });
    if (recent) {
      const recentSig = this.itemSignature(
        recent.items.map((i) => ({ variantId: i.variantId, quantity: Number(i.quantity) })),
      );
      if (recentSig === sig) {
        return this.toPublicOrder(tenantSlug, recent, subtotal, Number(recent.deliveryFeeAmount));
      }
    }
    void idem;

    const userId = await this.systemUserId(db);
    const customerId = await this.upsertCustomer(db, customerName, phone, {
      saveCustomerData,
      address:
        fulfillment === ServiceTabFulfillment.DELIVERY && saveCustomerData
          ? {
              street: addrFields?.street?.trim()?.slice(0, 120) || null,
              number: addrFields?.number?.trim()?.slice(0, 20) || null,
              complement: addrFields?.complement?.trim()?.slice(0, 80) || null,
              district: addrFields?.district?.trim()?.slice(0, 80) || null,
              city: (addrFields?.city?.trim() || co.city?.trim() || null)?.slice(0, 80) ?? null,
              state: co.state?.trim()?.slice(0, 2) || null,
            }
          : null,
    });
    const publicToken = randomUUID().replace(/-/g, '');
    const awaitingPix = paymentMode === DeliveryPaymentMode.PIX_ONLINE;
    const printMode = co.deliveryPrintMode ?? DeliveryPrintMode.DIRECT;
    const stockMode = co.deliveryStockMode ?? DeliveryStockMode.FULL;

    const tab = await db.serviceTab.create({
      data: {
        customerId,
        notes: body.notes?.trim()?.slice(0, 240) || null,
        openedById: userId,
        guestCount: 1,
        fulfillment,
        deliveryAddress: fulfillment === ServiceTabFulfillment.DELIVERY ? address : null,
        deliveryNotes: body.notes?.trim()?.slice(0, 240) || null,
        deliveryPhone: phone,
        deliveryFeeAmount: String(fee.toFixed(2)),
        publicToken,
        paymentMode,
        deliveryPrintStatus:
          awaitingPix || printMode === DeliveryPrintMode.DIRECT
            ? null
            : DeliveryPrintStatus.PENDING_COUNTER,
        deliveryStatus: awaitingPix
          ? DeliveryOrderStatus.AWAITING_PAYMENT
          : DeliveryOrderStatus.RECEIVED,
      },
    });

    for (const line of lines) {
      if (stockMode === DeliveryStockMode.FULL) {
        await this.sales.consumeStockForLines(
          tenantSlug,
          userId,
          [{ variantId: line.variantId, quantity: line.quantity }],
          `Delivery #${tab.number}`,
        );
      }
      await db.serviceTabItem.create({
        data: {
          tabId: tab.id,
          variantId: line.variantId,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
          discount: '0',
          totalLine: String(money(line.quantity * line.unitPrice).toFixed(2)),
          notes: line.notes,
          status: ServiceTabItemStatus.ORDERED,
        },
      });
    }

    if (!awaitingPix) {
      await this.dispatchConfirmed(tenantSlug, tab.id, printMode);
    }

    const created = await db.serviceTab.findUniqueOrThrow({
      where: { id: tab.id },
      include: orderInclude,
    });
    return this.toPublicOrder(tenantSlug, created, subtotal, fee, total);
  }

  private async findCustomerIdByPhone(db: TenantDb, phoneDigits: string): Promise<string | null> {
    const exact = await db.customer.findFirst({
      where: { phone: phoneDigits },
      select: { id: true },
    });
    if (exact) return exact.id;
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Customer"
      WHERE phone IS NOT NULL
        AND regexp_replace(phone, '[^0-9]', '', 'g') = ${phoneDigits}
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  private async upsertCustomer(
    db: TenantDb,
    name: string,
    phoneDigits: string,
    opts?: {
      saveCustomerData?: boolean;
      address?: {
        street: string | null;
        number: string | null;
        complement: string | null;
        district: string | null;
        city: string | null;
        state: string | null;
      } | null;
    },
  ): Promise<string> {
    const existingId = await this.findCustomerIdByPhone(db, phoneDigits);
    const baseData = { name, phone: phoneDigits };

    if (existingId) {
      if (opts?.saveCustomerData && opts.address) {
        const cur = await db.customer.findUnique({
          where: { id: existingId },
          select: { segment: true, notes: true },
        });
        const today = new Date().toISOString().slice(0, 10);
        const noteLine = `Origem: pedido delivery (${today})`;
        await db.customer.update({
          where: { id: existingId },
          data: {
            ...baseData,
            street: opts.address.street,
            number: opts.address.number,
            complement: opts.address.complement,
            district: opts.address.district,
            city: opts.address.city,
            state: opts.address.state,
            segment: cur?.segment?.trim() ? cur.segment : 'Delivery',
            notes: cur?.notes?.trim() ? cur.notes : noteLine,
          },
        });
      } else {
        await db.customer.update({
          where: { id: existingId },
          data: baseData,
        });
      }
      return existingId;
    }

    const noteLine = `Origem: pedido delivery (${new Date().toISOString().slice(0, 10)})`;
    const created = await db.customer.create({
      data: {
        ...baseData,
        ...(opts?.saveCustomerData && opts.address
          ? {
              street: opts.address.street,
              number: opts.address.number,
              complement: opts.address.complement,
              district: opts.address.district,
              city: opts.address.city,
              state: opts.address.state,
              segment: 'Delivery',
              notes: noteLine,
            }
          : {}),
      },
      select: { id: true },
    });
    return created.id;
  }

  private async dispatchConfirmed(
    tenantSlug: string,
    tabId: string,
    printMode: DeliveryPrintMode,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    if (printMode === DeliveryPrintMode.DIRECT) {
      await this.restaurant.markKitchenPrinted(tenantSlug, tabId);
      await db.serviceTab.update({
        where: { id: tabId },
        data: {
          deliveryPrintStatus: DeliveryPrintStatus.SENT_KITCHEN,
          deliveryStatus: DeliveryOrderStatus.PREPARING,
        },
      });
      return;
    }
    await db.serviceTab.update({
      where: { id: tabId },
      data: {
        deliveryPrintStatus: DeliveryPrintStatus.PENDING_COUNTER,
        deliveryStatus: DeliveryOrderStatus.RECEIVED,
      },
    });
  }

  /** Após PIX confirmado: aceito; cozinha só no balcão via sendToKitchen. */
  private async advanceOrderAfterPixPayment(tenantSlug: string, tabId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const tab = await db.serviceTab.findUnique({ where: { id: tabId } });
    if (!tab || tab.status !== ServiceTabStatus.OPEN) return;
    if (tab.deliveryStatus !== DeliveryOrderStatus.AWAITING_PAYMENT) return;

    const co = await db.company.findFirst({ select: { deliveryPrintMode: true } });
    const printMode = co?.deliveryPrintMode ?? DeliveryPrintMode.DIRECT;
    if (printMode === DeliveryPrintMode.DIRECT) {
      await this.dispatchConfirmed(tenantSlug, tabId, printMode);
      return;
    }
    await db.serviceTab.update({
      where: { id: tabId },
      data: {
        deliveryStatus: DeliveryOrderStatus.ACCEPTED,
        deliveryPrintStatus: DeliveryPrintStatus.PENDING_COUNTER,
      },
    });
  }

  async getLatestOrderForPhone(slugOuHost: string, phoneRaw: string) {
    const phone = digitsPhone(phoneRaw);
    if (phone.length < 8) {
      throw new BadRequestException('Informe um telefone válido.');
    }
    const tenantSlug = await this.resolveSlug(slugOuHost);
    const db = await this.db(tenantSlug, { public: true });
    const rows = await db.$queryRaw<
      Array<{
        publicToken: string;
        number: number;
        deliveryStatus: DeliveryOrderStatus | null;
        createdAt: Date;
      }>
    >`
      SELECT "publicToken", number, "deliveryStatus", "createdAt"
      FROM "ServiceTab"
      WHERE "fulfillment" IN ('DELIVERY', 'PICKUP')
        AND "publicToken" IS NOT NULL
        AND "deliveryPhone" IS NOT NULL
        AND regexp_replace("deliveryPhone", '[^0-9]', '', 'g') = ${phone}
      ORDER BY number DESC
      LIMIT 1
    `;
    const tab = rows[0];
    if (!tab?.publicToken) return { order: null as null };
    return {
      order: {
        token: tab.publicToken,
        number: tab.number,
        deliveryStatus: tab.deliveryStatus,
        placedAt: tab.createdAt.getTime(),
      },
    };
  }

  async getPublicOrder(slugOuHost: string, publicToken: string) {
    const tenantSlug = await this.resolveSlug(slugOuHost);
    const db = await this.db(tenantSlug, { public: true });
    const tab = await db.serviceTab.findFirst({
      where: { publicToken: String(publicToken ?? '').trim() },
      include: orderInclude,
    });
    if (!tab) throw new NotFoundException();
    const subtotal = money(
      tab.items.reduce((s, i) => s + Number(i.totalLine), 0),
    );
    const fee = money(Number(tab.deliveryFeeAmount ?? 0));
    return this.toPublicOrder(tenantSlug, tab, subtotal, fee);
  }

  async createPublicPix(slugOuHost: string, publicToken: string) {
    const tenantSlug = await this.resolveSlug(slugOuHost);
    const db = await this.db(tenantSlug, { public: true });
    const tab = await db.serviceTab.findFirst({
      where: { publicToken: String(publicToken ?? '').trim() },
      include: orderInclude,
    });
    if (!tab) throw new NotFoundException();
    if (tab.paymentMode !== DeliveryPaymentMode.PIX_ONLINE) {
      throw new BadRequestException('Este pedido não usa PIX online.');
    }
    if (tab.status !== ServiceTabStatus.OPEN) {
      throw new BadRequestException('Pedido já encerrado.');
    }
    const subtotal = money(tab.items.reduce((s, i) => s + Number(i.totalLine), 0));
    const fee = money(Number(tab.deliveryFeeAmount ?? 0));
    const amount = money(subtotal + fee);
    const intent = await this.payments.createPixCharge(tenantSlug, {
      amount,
      description: `Delivery #${tab.number}`,
      metadata: {
        kind: 'DELIVERY',
        deliveryTabId: tab.id,
        publicToken: tab.publicToken,
      },
    });
    return intent;
  }

  async getPublicPix(slugOuHost: string, publicToken: string) {
    const tenantSlug = await this.resolveSlug(slugOuHost);
    await this.assertDeliveryEnabled(tenantSlug, { public: true });
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const tab = await db.serviceTab.findFirst({
      where: { publicToken: String(publicToken ?? '').trim() },
      select: { id: true, number: true },
    });
    if (!tab) throw new NotFoundException();
    const recent = await db.paymentIntent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    const intent = recent.find((row) => {
      const meta = (row.metadata ?? {}) as { deliveryTabId?: string };
      return meta.deliveryTabId === tab.id;
    });
    if (!intent) return { status: 'NONE' as const, intent: null };
    if (intent.status !== PaymentIntentStatus.CONFIRMED && intent.externalId) {
      const synced = await this.payments.syncIntentStatus(tenantSlug, intent.id);
      return { status: synced.status, intent: this.payments.toDto(synced) };
    }
    return { status: intent.status, intent: this.payments.toDto(intent) };
  }

  /** Celular: sincroniza PIX e avança para pedido aceito (estrutura pronta para confirmação no app). */
  async confirmPublicPix(slugOuHost: string, publicToken: string) {
    const tenantSlug = await this.resolveSlug(slugOuHost);
    await this.assertDeliveryEnabled(tenantSlug, { public: true });
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const tab = await db.serviceTab.findFirst({
      where: { publicToken: String(publicToken ?? '').trim() },
      select: { id: true, paymentMode: true, deliveryStatus: true, status: true },
    });
    if (!tab) throw new NotFoundException();
    if (tab.paymentMode !== DeliveryPaymentMode.PIX_ONLINE) {
      throw new BadRequestException('Este pedido não usa PIX online.');
    }
    const pix = await this.getPublicPix(slugOuHost, publicToken);
    if (pix.status === PaymentIntentStatus.CONFIRMED) {
      await this.advanceOrderAfterPixPayment(tenantSlug, tab.id);
    }
    const order = await this.getPublicOrder(slugOuHost, publicToken);
    return {
      pixStatus: pix.status,
      order,
    };
  }

  async onPixConfirmed(
    tenantSlug: string,
    intent: { status: PaymentIntentStatus; metadata?: unknown },
  ) {
    if (intent.status !== PaymentIntentStatus.CONFIRMED) return;
    const meta = (intent.metadata ?? {}) as { kind?: string; deliveryTabId?: string };
    if (meta.kind !== 'DELIVERY' || !meta.deliveryTabId) return;
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const tab = await db.serviceTab.findUnique({ where: { id: meta.deliveryTabId } });
    if (!tab || tab.status !== ServiceTabStatus.OPEN) return;
    if (tab.deliveryStatus !== DeliveryOrderStatus.AWAITING_PAYMENT) return;
    await this.advanceOrderAfterPixPayment(tenantSlug, tab.id);
  }

  async listStaffOrders(tenantSlug: string) {
    const db = await this.db(tenantSlug);
    return db.serviceTab.findMany({
      where: {
        status: ServiceTabStatus.OPEN,
        fulfillment: { in: [ServiceTabFulfillment.DELIVERY, ServiceTabFulfillment.PICKUP] },
      },
      orderBy: { createdAt: 'asc' },
      include: orderInclude,
    });
  }

  async pendingCounterCount(tenantSlug: string) {
    const db = await this.db(tenantSlug);
    return db.serviceTab.count({
      where: {
        status: ServiceTabStatus.OPEN,
        fulfillment: { in: [ServiceTabFulfillment.DELIVERY, ServiceTabFulfillment.PICKUP] },
        deliveryPrintStatus: DeliveryPrintStatus.PENDING_COUNTER,
        deliveryStatus: DeliveryOrderStatus.ACCEPTED,
      },
    });
  }

  async acceptOrder(tenantSlug: string, tabId: string) {
    await this.assertDeliveryEnabled(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const tab = await db.serviceTab.findUnique({ where: { id: tabId } });
    if (!tab) throw new NotFoundException('Pedido não encontrado.');
    if (
      tab.fulfillment !== ServiceTabFulfillment.DELIVERY &&
      tab.fulfillment !== ServiceTabFulfillment.PICKUP
    ) {
      throw new BadRequestException('Comanda não é um pedido delivery.');
    }
    if (tab.deliveryStatus !== DeliveryOrderStatus.RECEIVED) {
      throw new BadRequestException('Este pedido já foi aceito ou está em outra fase.');
    }
    return db.serviceTab.update({
      where: { id: tabId },
      data: { deliveryStatus: DeliveryOrderStatus.ACCEPTED },
      include: orderInclude,
    });
  }

  async sendToKitchen(tenantSlug: string, tabId: string) {
    await this.assertDeliveryEnabled(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const tab = await db.serviceTab.findUnique({ where: { id: tabId } });
    if (!tab) throw new NotFoundException('Pedido não encontrado.');
    if (
      tab.fulfillment !== ServiceTabFulfillment.DELIVERY &&
      tab.fulfillment !== ServiceTabFulfillment.PICKUP
    ) {
      throw new BadRequestException('Comanda não é um pedido delivery.');
    }
    if (tab.deliveryStatus === DeliveryOrderStatus.AWAITING_PAYMENT) {
      throw new BadRequestException('Aguarde a confirmação do PIX.');
    }
    if (tab.deliveryStatus !== DeliveryOrderStatus.ACCEPTED) {
      throw new BadRequestException('O pedido não está aguardando início do preparo.');
    }
    if (tab.deliveryPrintStatus !== DeliveryPrintStatus.PENDING_COUNTER) {
      throw new BadRequestException('Este pedido não aguarda envio à cozinha pelo balcão.');
    }
    const printed = await this.restaurant.markKitchenPrinted(tenantSlug, tabId);
    await db.serviceTab.update({
      where: { id: tabId },
      data: {
        deliveryPrintStatus: DeliveryPrintStatus.SENT_KITCHEN,
        deliveryStatus: DeliveryOrderStatus.PREPARING,
      },
    });
    return printed;
  }

  async setStatus(
    tenantSlug: string,
    tabId: string,
    status: 'OUT_FOR_DELIVERY' | 'READY_PICKUP' | 'PREPARING' | 'COMPLETED',
  ) {
    const db = await this.db(tenantSlug);
    const tab = await db.serviceTab.findUnique({ where: { id: tabId } });
    if (!tab) throw new NotFoundException('Pedido não encontrado.');
    if (tab.fulfillment !== ServiceTabFulfillment.DELIVERY && tab.fulfillment !== ServiceTabFulfillment.PICKUP) {
      throw new BadRequestException('Comanda não é um pedido delivery.');
    }
    if (status === 'OUT_FOR_DELIVERY' && tab.fulfillment !== ServiceTabFulfillment.DELIVERY) {
      throw new BadRequestException('Este pedido é retirada no local.');
    }
    if (status === 'READY_PICKUP' && tab.fulfillment !== ServiceTabFulfillment.PICKUP) {
      throw new BadRequestException('Este pedido é entrega.');
    }
    const next =
      status === 'OUT_FOR_DELIVERY'
        ? DeliveryOrderStatus.OUT_FOR_DELIVERY
        : status === 'READY_PICKUP'
          ? DeliveryOrderStatus.READY_PICKUP
          : status === 'COMPLETED'
            ? DeliveryOrderStatus.COMPLETED
            : DeliveryOrderStatus.PREPARING;
    return db.serviceTab.update({
      where: { id: tabId },
      data: { deliveryStatus: next },
      include: orderInclude,
    });
  }

  private toPublicOrder(
    tenantSlug: string,
    tab: {
      id: string;
      number: number;
      status: ServiceTabStatus;
      fulfillment: ServiceTabFulfillment;
      publicToken: string | null;
      paymentMode: DeliveryPaymentMode | null;
      deliveryStatus: DeliveryOrderStatus | null;
      deliveryPrintStatus?: DeliveryPrintStatus | null;
      deliveryAddress: string | null;
      deliveryPhone: string | null;
      deliveryFeeAmount: unknown;
      notes: string | null;
      items: Array<{
        quantity: unknown;
        unitPrice: unknown;
        totalLine: unknown;
        notes: string | null;
        variant: { product: { name: string } };
      }>;
      customer: { name: string } | null;
    },
    subtotal: number,
    fee: number,
    total?: number,
  ) {
    const itemsTotal = money(subtotal);
    const feeAmt = money(fee);
    return {
      token: tab.publicToken,
      number: tab.number,
      status: tab.status,
      fulfillment: tab.fulfillment,
      paymentMode: tab.paymentMode,
      deliveryStatus: tab.deliveryStatus,
      deliveryPrintStatus: tab.deliveryPrintStatus ?? null,
      canConfirmPixFromMobile:
        tab.paymentMode === DeliveryPaymentMode.PIX_ONLINE &&
        tab.deliveryStatus === DeliveryOrderStatus.AWAITING_PAYMENT,
      customerName: tab.customer?.name ?? '',
      phone: tab.deliveryPhone,
      address: tab.deliveryAddress,
      notes: tab.notes,
      items: tab.items.map((it) => ({
        name: it.variant.product.name,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        total: Number(it.totalLine),
        notes: it.notes,
      })),
      subtotal: itemsTotal,
      deliveryFee: feeAmt,
      total: total ?? money(itemsTotal + feeAmt),
      tenantSlug,
    };
  }
}
