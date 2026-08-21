import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityLogAction,
  PaymentMethod,
  Prisma,
  SaleSource,
  ServiceOrderItemKind,
  ServiceOrderStatus,
  ServiceOrderType,
  StockMovementSource,
  StockMovementType,
} from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { CompanyService } from '../company/company.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SalesService } from '../sales/sales.service';
import { resolveSaleStockQuantity } from '../common/product-conversion.util';

type ActingUser = { sub: string; roles: string[] };

export type ServiceOrderItemInput = {
  kind?: ServiceOrderItemKind | string;
  variantId?: string | null;
  description?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  discount?: number | string;
};

export type CreateServiceOrderInput = {
  customerId: string;
  equipmentId?: string | null;
  assetDescription?: string | null;
  type?: ServiceOrderType | string;
  problemReport?: string | null;
  diagnosis?: string | null;
  internalNotes?: string | null;
  assignedToId?: string | null;
  promisedAt?: string | null;
  depositAmount?: number | string;
  intakeChecklist?: Array<{ label: string; checked?: boolean }> | null;
  items?: ServiceOrderItemInput[];
  status?: ServiceOrderStatus | string;
};

export type UpdateServiceOrderInput = {
  equipmentId?: string | null;
  assetDescription?: string | null;
  type?: ServiceOrderType | string;
  problemReport?: string | null;
  diagnosis?: string | null;
  internalNotes?: string | null;
  assignedToId?: string | null;
  promisedAt?: string | null;
  depositAmount?: number | string;
  intakeChecklist?: Array<{ label: string; checked?: boolean }> | null;
  items?: ServiceOrderItemInput[];
};

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseMoney(raw: unknown, label: string): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException(`${label} inválido.`);
  }
  return roundMoney2(n);
}

function parseQty(raw: unknown, label: string): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(`${label} inválido.`);
  }
  return n;
}

const ALLOWED: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
  DRAFT: [
    ServiceOrderStatus.QUOTE,
    ServiceOrderStatus.APPROVED,
    ServiceOrderStatus.IN_PROGRESS,
    ServiceOrderStatus.CANCELLED,
  ],
  QUOTE: [ServiceOrderStatus.APPROVED, ServiceOrderStatus.CANCELLED],
  APPROVED: [
    ServiceOrderStatus.IN_PROGRESS,
    ServiceOrderStatus.QUOTE,
    ServiceOrderStatus.CANCELLED,
  ],
  IN_PROGRESS: [
    ServiceOrderStatus.WAITING_PARTS,
    ServiceOrderStatus.READY,
    ServiceOrderStatus.APPROVED,
    ServiceOrderStatus.CANCELLED,
  ],
  WAITING_PARTS: [
    ServiceOrderStatus.IN_PROGRESS,
    ServiceOrderStatus.READY,
    ServiceOrderStatus.CANCELLED,
  ],
  READY: [
    ServiceOrderStatus.DELIVERED,
    ServiceOrderStatus.IN_PROGRESS,
    ServiceOrderStatus.WAITING_PARTS,
    ServiceOrderStatus.CANCELLED,
  ],
  DELIVERED: [
    ServiceOrderStatus.READY,
    ServiceOrderStatus.IN_PROGRESS,
    ServiceOrderStatus.CANCELLED,
  ],
  BILLED: [],
  CANCELLED: [],
};

const ORDER_INCLUDE = {
  customer: { select: { id: true, name: true, document: true, phone: true } },
  equipment: true,
  openedBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  items: {
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          barcode: true,
          retailPrice: true,
          product: { select: { id: true, name: true, isService: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  sale: { select: { id: true, number: true, total: true, createdAt: true } },
  depositSale: { select: { id: true, number: true, total: true } },
} satisfies Prisma.ServiceOrderInclude;

@Injectable()
export class ServiceOrdersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sales: SalesService,
    private readonly company: CompanyService,
    private readonly activityLog: ActivityLogService,
  ) {}

  private async assertCompanyModule(tenantSlug: string) {
    const co = await this.company.getOrCreate(tenantSlug);
    if (!co.serviceOrderModuleEnabled) {
      throw new ForbiddenException(
        'Módulo Ordem de Serviços desativado na Empresa. Ative em Cadastro da empresa → Ordem de Serviços.',
      );
    }
    return co;
  }

  private serializeOrder(order: any) {
    const items = (order.items ?? []).map((it: any) => ({
      ...it,
      quantity: String(it.quantity),
      unitPrice: String(it.unitPrice),
      discount: String(it.discount),
      totalLine: String(it.totalLine),
    }));
    const itemsTotal = items.reduce(
      (s: number, it: any) => s + Number(it.totalLine),
      0,
    );
    const deposit = Number(order.depositAmount ?? 0);
    const total = roundMoney2(itemsTotal);
    return {
      ...order,
      depositAmount: String(order.depositAmount ?? 0),
      itemsTotal: total,
      /** Quanto ainda falta pagar após o sinal (nunca negativo). */
      balanceDue: roundMoney2(Math.max(0, total - deposit)),
      /** Sobra do sinal quando o depósito supera o total dos itens. */
      depositCredit: roundMoney2(Math.max(0, deposit - total)),
      items,
    };
  }

  private normalizeItems(items: ServiceOrderItemInput[] | undefined) {
    const list = items ?? [];
    return list.map((raw, idx) => {
      const kindRaw = String(raw.kind ?? ServiceOrderItemKind.PART).toUpperCase();
      if (!Object.values(ServiceOrderItemKind).includes(kindRaw as ServiceOrderItemKind)) {
        throw new BadRequestException(`Item ${idx + 1}: tipo inválido.`);
      }
      const kind = kindRaw as ServiceOrderItemKind;
      const qty = parseQty(raw.quantity, `Item ${idx + 1}: quantidade`);
      const unitPrice = parseMoney(raw.unitPrice, `Item ${idx + 1}: preço`);
      const discount = parseMoney(raw.discount ?? 0, `Item ${idx + 1}: desconto`);
      const totalLine = roundMoney2(Math.max(0, qty * unitPrice - discount));
      const variantId = raw.variantId ? String(raw.variantId).trim() : null;
      const description = raw.description ? String(raw.description).trim() : null;
      if (!variantId && !description) {
        throw new BadRequestException(
          `Item ${idx + 1}: informe produto ou descrição.`,
        );
      }
      return { kind, variantId, description, quantity: qty, unitPrice, discount, totalLine };
    });
  }

  async list(
    tenantSlug: string,
    opts: {
      status?: string;
      from?: string;
      to?: string;
      customerId?: string;
      assignedToId?: string;
      type?: string;
      take?: number;
    },
  ) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.ServiceOrderWhereInput = {};
    if (opts.status) {
      const st = String(opts.status).toUpperCase();
      if (Object.values(ServiceOrderStatus).includes(st as ServiceOrderStatus)) {
        where.status = st as ServiceOrderStatus;
      }
    }
    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.assignedToId) where.assignedToId = opts.assignedToId;
    if (opts.type) {
      const t = String(opts.type).toUpperCase();
      if (Object.values(ServiceOrderType).includes(t as ServiceOrderType)) {
        where.type = t as ServiceOrderType;
      }
    }
    if (opts.from || opts.to) {
      where.openedAt = {};
      if (opts.from) {
        const d = new Date(opts.from);
        d.setHours(0, 0, 0, 0);
        where.openedAt.gte = d;
      }
      if (opts.to) {
        const d = new Date(opts.to);
        d.setHours(23, 59, 59, 999);
        where.openedAt.lte = d;
      }
    }
    const take = Math.min(Math.max(opts.take ?? 100, 1), 500);
    const rows = await db.serviceOrder.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { openedAt: 'desc' },
      take,
    });
    return rows.map((r) => this.serializeOrder(r));
  }

  async search(tenantSlug: string, q: string) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const term = String(q ?? '').trim();
    if (term.length < 1) return [];
    const asNum = /^\d+$/.test(term) ? Number(term) : null;
    const rows = await db.serviceOrder.findMany({
      where: {
        OR: [
          ...(asNum != null ? [{ number: asNum }] : []),
          { customer: { name: { contains: term, mode: 'insensitive' } } },
          { customer: { phone: { contains: term } } },
          { customer: { document: { contains: term } } },
          { equipment: { serialNumber: { contains: term, mode: 'insensitive' } } },
          { equipment: { plateOrTag: { contains: term, mode: 'insensitive' } } },
          { assetDescription: { contains: term, mode: 'insensitive' } },
        ],
      },
      include: ORDER_INCLUDE,
      orderBy: { openedAt: 'desc' },
      take: 30,
    });
    return rows.map((r) => this.serializeOrder(r));
  }

  async detail(tenantSlug: string, id: string) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.serviceOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!row) throw new NotFoundException('Ordem de serviço não encontrada.');
    return this.serializeOrder(row);
  }

  async create(tenantSlug: string, user: ActingUser, input: CreateServiceOrderInput) {
    const co = await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const customer = await db.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new BadRequestException('Cliente inválido.');

    if (co.serviceOrderRequireEquipment) {
      if (!input.equipmentId && !String(input.assetDescription ?? '').trim()) {
        throw new BadRequestException(
          'Informe o equipamento ou a descrição do bem (obrigatório pela configuração da empresa).',
        );
      }
    }

    if (input.equipmentId) {
      const eq = await db.customerEquipment.findFirst({
        where: { id: input.equipmentId, customerId: input.customerId },
      });
      if (!eq) throw new BadRequestException('Equipamento não pertence a este cliente.');
    }

    const items = this.normalizeItems(input.items);
    let status: ServiceOrderStatus = ServiceOrderStatus.DRAFT;
    if (input.status) {
      const st = String(input.status).toUpperCase();
      if (Object.values(ServiceOrderStatus).includes(st as ServiceOrderStatus)) {
        status = st as ServiceOrderStatus;
      }
    } else if (co.serviceOrderAllowQuote) {
      status = ServiceOrderStatus.QUOTE;
    } else {
      status = ServiceOrderStatus.APPROVED;
    }

    let type: ServiceOrderType = ServiceOrderType.CORRECTIVE;
    if (input.type) {
      const t = String(input.type).toUpperCase();
      if (Object.values(ServiceOrderType).includes(t as ServiceOrderType)) {
        type = t as ServiceOrderType;
      }
    }

    const created = await db.serviceOrder.create({
      data: {
        status,
        type,
        customerId: input.customerId,
        equipmentId: input.equipmentId || null,
        assetDescription: input.assetDescription?.trim() || null,
        problemReport: input.problemReport?.trim() || null,
        diagnosis: input.diagnosis?.trim() || null,
        internalNotes: input.internalNotes?.trim() || null,
        intakeChecklist: input.intakeChecklist ?? undefined,
        openedById: user.sub,
        assignedToId: input.assignedToId || null,
        promisedAt: input.promisedAt ? new Date(input.promisedAt) : null,
        depositAmount:
          input.depositAmount !== undefined
            ? parseMoney(input.depositAmount, 'Sinal')
            : 0,
        items: {
          create: items.map((it) => ({
            kind: it.kind,
            variantId: it.variantId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discount: it.discount,
            totalLine: it.totalLine,
          })),
        },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: status,
            userId: user.sub,
            note: 'Abertura',
          },
        },
      },
      include: ORDER_INCLUDE,
    });

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.CREATE,
      summary: `Abriu OS #${created.number}`,
      entityType: 'service_order',
      entityRef: created.id,
    });

    return this.serializeOrder(created);
  }

  async update(tenantSlug: string, user: ActingUser, id: string, input: UpdateServiceOrderInput) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const current = await db.serviceOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!current) throw new NotFoundException('Ordem de serviço não encontrada.');
    if (
      current.status === ServiceOrderStatus.BILLED ||
      current.status === ServiceOrderStatus.CANCELLED
    ) {
      throw new BadRequestException('OS faturada ou cancelada não pode ser editada.');
    }

    const data: Prisma.ServiceOrderUpdateInput = {};
    if (input.equipmentId !== undefined) {
      if (input.equipmentId) {
        const eq = await db.customerEquipment.findFirst({
          where: { id: input.equipmentId, customerId: current.customerId },
        });
        if (!eq) throw new BadRequestException('Equipamento inválido.');
        data.equipment = { connect: { id: input.equipmentId } };
      } else {
        data.equipment = { disconnect: true };
      }
    }
    if (input.assetDescription !== undefined) {
      data.assetDescription = input.assetDescription?.trim() || null;
    }
    if (input.problemReport !== undefined) data.problemReport = input.problemReport?.trim() || null;
    if (input.diagnosis !== undefined) data.diagnosis = input.diagnosis?.trim() || null;
    if (input.internalNotes !== undefined) data.internalNotes = input.internalNotes?.trim() || null;
    if (input.assignedToId !== undefined) {
      data.assignedTo = input.assignedToId
        ? { connect: { id: input.assignedToId } }
        : { disconnect: true };
    }
    if (input.promisedAt !== undefined) {
      data.promisedAt = input.promisedAt ? new Date(input.promisedAt) : null;
    }
    if (input.depositAmount !== undefined) {
      data.depositAmount = parseMoney(input.depositAmount, 'Sinal');
    }
    if (input.intakeChecklist !== undefined) {
      data.intakeChecklist = input.intakeChecklist ?? Prisma.JsonNull;
    }
    if (input.type) {
      const t = String(input.type).toUpperCase();
      if (Object.values(ServiceOrderType).includes(t as ServiceOrderType)) {
        data.type = t as ServiceOrderType;
      }
    }

    await db.$transaction(async (tx) => {
      if (input.items) {
        const items = this.normalizeItems(input.items);
        await tx.serviceOrderItem.deleteMany({ where: { orderId: id } });
        await tx.serviceOrderItem.createMany({
          data: items.map((it) => ({
            orderId: id,
            kind: it.kind,
            variantId: it.variantId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discount: it.discount,
            totalLine: it.totalLine,
          })),
        });
      }
      await tx.serviceOrder.update({ where: { id }, data });
    });

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.UPDATE,
      summary: `Alterou OS #${current.number}`,
      entityType: 'service_order',
      entityRef: id,
    });

    return this.detail(tenantSlug, id);
  }

  async changeStatus(
    tenantSlug: string,
    user: ActingUser,
    id: string,
    toStatusRaw: string,
    note?: string,
  ) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const order = await db.serviceOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');

    const toStatus = String(toStatusRaw).toUpperCase() as ServiceOrderStatus;
    if (!Object.values(ServiceOrderStatus).includes(toStatus)) {
      throw new BadRequestException('Status inválido.');
    }
    if (toStatus === ServiceOrderStatus.BILLED) {
      throw new BadRequestException('Use o faturamento para marcar como faturada.');
    }
    const allowed = ALLOWED[order.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(
        `Transição ${order.status} → ${toStatus} não permitida.`,
      );
    }

    const extra: Prisma.ServiceOrderUpdateInput = { status: toStatus };
    if (toStatus === ServiceOrderStatus.READY || toStatus === ServiceOrderStatus.DELIVERED) {
      extra.completedAt = order.completedAt ?? new Date();
    }
    if (toStatus === ServiceOrderStatus.DELIVERED) {
      extra.deliveredAt = new Date();
    }

    await db.$transaction([
      db.serviceOrder.update({ where: { id }, data: extra }),
      db.serviceOrderStatusLog.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus,
          userId: user.sub,
          note: note?.trim() || null,
        },
      }),
    ]);

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.UPDATE,
      summary: `OS #${order.number}: ${order.status} → ${toStatus}`,
      entityType: 'service_order',
      entityRef: id,
    });

    return this.detail(tenantSlug, id);
  }

  async cancel(tenantSlug: string, user: ActingUser, id: string, note?: string) {
    return this.changeStatus(tenantSlug, user, id, ServiceOrderStatus.CANCELLED, note);
  }

  async billingPreview(tenantSlug: string, id: string) {
    const order = await this.detail(tenantSlug, id);
    if (
      order.status !== ServiceOrderStatus.READY &&
      order.status !== ServiceOrderStatus.DELIVERED
    ) {
      throw new BadRequestException('OS precisa estar pronta ou entregue para faturar.');
    }
    if (order.saleId) {
      throw new BadRequestException('OS já faturada.');
    }
    const missing = (order.items as any[]).filter((it) => !it.variantId);
    return {
      order,
      canBill: missing.length === 0 && (order.items as any[]).length > 0,
      missingVariantItems: missing.map((it: any) => it.id),
      balanceDue: order.balanceDue,
    };
  }

  async bill(
    tenantSlug: string,
    user: ActingUser,
    id: string,
    body: {
      payments: Array<{
        method: PaymentMethod | string;
        amount: number | string;
        installments?: number;
        paymentFormId?: string | null;
        authCode?: string | null;
      }>;
      cashSessionId?: string | null;
      discount?: number | string;
      notes?: string | null;
      permissionPassword?: string;
    },
  ) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const order = await db.serviceOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            variant: { include: { product: { select: { isService: true, name: true } } } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');
    if (order.saleId) throw new BadRequestException('OS já faturada.');
    if (
      order.status !== ServiceOrderStatus.READY &&
      order.status !== ServiceOrderStatus.DELIVERED
    ) {
      throw new BadRequestException('OS precisa estar pronta ou entregue para faturar.');
    }
    if (!order.items.length) throw new BadRequestException('OS sem itens.');
    const withoutVariant = order.items.filter((it) => !it.variantId);
    if (withoutVariant.length) {
      throw new BadRequestException(
        'Todos os itens precisam de produto do catálogo para faturar. Vincule um produto nas linhas de serviço.',
      );
    }

    const deposit = Number(order.depositAmount);
    const itemsTotal = order.items.reduce((s, it) => s + Number(it.totalLine), 0);
    const balanceDue = roundMoney2(Math.max(0, itemsTotal - deposit));
    const discount = parseMoney(body.discount ?? 0, 'Desconto');

    const partItems = order.items.filter(
      (it) =>
        it.kind === ServiceOrderItemKind.PART &&
        it.variantId &&
        !it.variant?.product?.isService,
    );
    const allPartsConsumed =
      partItems.length === 0 || partItems.every((it) => it.consumedAt != null);
    const someConsumed = partItems.some((it) => it.consumedAt != null);
    const deductStock = allPartsConsumed ? false : !someConsumed;

    const sale = await this.sales.create({
      tenantSlug,
      userId: user.sub,
      userRoles: user.roles,
      permissionPassword: body.permissionPassword,
      customerId: order.customerId,
      notes: body.notes ?? `OS #${order.number}`,
      discount,
      source: SaleSource.SERVICE_ORDER,
      cashSessionId: body.cashSessionId ?? null,
      externalRef: `OS:${order.number}`,
      deductStock,
      items: order.items.map((it) => ({
        variantId: it.variantId!,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        discount: Number(it.discount),
      })),
      payments: (body.payments ?? []).map((p) => ({
        method: String(p.method).toUpperCase() as PaymentMethod,
        amount: p.amount,
        installments: p.installments,
        paymentFormId: p.paymentFormId,
        authCode: p.authCode,
      })),
    });

    // Se mistura consumido/não consumido: baixa o restante agora.
    if (someConsumed && !allPartsConsumed) {
      const defaultLoc = await db.stockLocation.findFirst({
        where: { isDefault: true },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (defaultLoc) {
        for (const it of partItems) {
          if (it.consumedAt || !it.variantId) continue;
          await this.consumeStockLine(db, tenantSlug, user.sub, order.id, it, defaultLoc.id);
        }
      }
    }

    // Ajuste de sinal: se havia depósito, o total pago na venda deve cobrir o saldo.
    // (O operador informa payments = balanceDue; validação já está no SalesService.)
    void balanceDue;

    await db.$transaction([
      db.serviceOrder.update({
        where: { id },
        data: {
          saleId: sale.id,
          status: ServiceOrderStatus.BILLED,
          completedAt: order.completedAt ?? new Date(),
          deliveredAt: order.deliveredAt ?? new Date(),
        },
      }),
      db.serviceOrderStatusLog.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: ServiceOrderStatus.BILLED,
          userId: user.sub,
          note: `Venda #${sale.number}`,
        },
      }),
    ]);

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.CREATE,
      summary: `Faturou OS #${order.number} → venda #${sale.number}`,
      entityType: 'service_order',
      entityRef: id,
    });

    return { order: await this.detail(tenantSlug, id), sale };
  }

  private async consumeStockLine(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    tenantSlug: string,
    userId: string,
    orderId: string,
    item: {
      id: string;
      variantId: string | null;
      quantity: Prisma.Decimal | number;
      variant?: {
        product?: {
          name?: string;
          conversion?: string | null;
          packItemQty?: Prisma.Decimal | number | null;
          stockComponentVariantId?: string | null;
        } | null;
      } | null;
    },
    locationId: string,
  ) {
    if (!item.variantId) return;
    const variant = await db.productVariant.findUniqueOrThrow({
      where: { id: item.variantId },
      include: {
        product: {
          select: {
            name: true,
            conversion: true,
            packItemQty: true,
            stockComponentVariantId: true,
            isService: true,
          },
        },
      },
    });
    if (variant.product.isService) return;

    const componentId = variant.product.stockComponentVariantId?.trim() || null;
    const stockQty = resolveSaleStockQuantity(
      Number(item.quantity),
      variant.product.conversion,
      Boolean(componentId),
      variant.product.packItemQty != null ? Number(variant.product.packItemQty) : null,
    );
    const stockVariantId = componentId ?? item.variantId;

    await db.$transaction(async (tx) => {
      const bal = await tx.stockBalance.findUnique({
        where: {
          variantId_locationId: { variantId: stockVariantId, locationId },
        },
      });
      const qtyOnHand = bal ? Number(bal.quantity) : 0;
      if (qtyOnHand + 1e-9 < stockQty) {
        throw new BadRequestException(
          `Estoque insuficiente para ${variant.product.name} (disp. ${qtyOnHand}).`,
        );
      }
      await tx.stockBalance.upsert({
        where: {
          variantId_locationId: { variantId: stockVariantId, locationId },
        },
        create: {
          variantId: stockVariantId,
          locationId,
          quantity: qtyOnHand - stockQty,
        },
        update: { quantity: qtyOnHand - stockQty },
      });
      await tx.stockMovement.create({
        data: {
          type: StockMovementType.OUT,
          source: StockMovementSource.SERVICE_ORDER,
          variantId: stockVariantId,
          locationId,
          quantity: stockQty,
          userId,
          reference: `OS:${orderId}`,
          outboundReason: 'Consumo OS',
        },
      });
      await tx.serviceOrderItem.update({
        where: { id: item.id },
        data: { consumedAt: new Date() },
      });
    });
  }

  async consumeItem(tenantSlug: string, user: ActingUser, orderId: string, itemId: string) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');
    if (
      order.status === ServiceOrderStatus.BILLED ||
      order.status === ServiceOrderStatus.CANCELLED
    ) {
      throw new BadRequestException('OS não permite consumo neste status.');
    }
    const item = await db.serviceOrderItem.findFirst({
      where: { id: itemId, orderId },
      include: {
        variant: {
          include: {
            product: {
              select: {
                name: true,
                isService: true,
                conversion: true,
                packItemQty: true,
                stockComponentVariantId: true,
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Item não encontrado.');
    if (item.consumedAt) throw new BadRequestException('Item já consumido.');
    if (!item.variantId || item.variant?.product?.isService) {
      throw new BadRequestException('Somente peças com estoque podem ser consumidas.');
    }
    const defaultLoc = await db.stockLocation.findFirst({
      where: { isDefault: true },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!defaultLoc) throw new BadRequestException('Local de estoque padrão não configurado.');

    await this.consumeStockLine(db, tenantSlug, user.sub, orderId, item, defaultLoc.id);

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.UPDATE,
      summary: `Consumiu peça na OS #${order.number}`,
      entityType: 'service_order',
      entityRef: orderId,
    });

    return this.detail(tenantSlug, orderId);
  }

  async linkSale(tenantSlug: string, user: ActingUser, id: string, saleId: string) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const order = await db.serviceOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');
    if (order.saleId) throw new BadRequestException('OS já faturada.');
    if (
      order.status !== ServiceOrderStatus.READY &&
      order.status !== ServiceOrderStatus.DELIVERED
    ) {
      throw new BadRequestException('OS precisa estar pronta ou entregue.');
    }
    const sale = await db.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Venda inválida.');

    await db.$transaction([
      db.serviceOrder.update({
        where: { id },
        data: {
          saleId,
          status: ServiceOrderStatus.BILLED,
          completedAt: order.completedAt ?? new Date(),
          deliveredAt: order.deliveredAt ?? new Date(),
        },
      }),
      db.serviceOrderStatusLog.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: ServiceOrderStatus.BILLED,
          userId: user.sub,
          note: `Venda #${sale.number} (PDV)`,
        },
      }),
    ]);

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.UPDATE,
      summary: `Vinculou venda #${sale.number} à OS #${order.number}`,
      entityType: 'service_order',
      entityRef: id,
    });

    return this.detail(tenantSlug, id);
  }

  async printData(tenantSlug: string, id: string) {
    const order = await this.detail(tenantSlug, id);
    const company = await this.company.getOrCreate(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const history: unknown[] = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    const userIds: string[] = [
      ...new Set(
        history
          .map((h: unknown) =>
            h && typeof h === 'object' && 'userId' in h
              ? (h as { userId?: string | null }).userId
              : null,
          )
          .filter((uid: string | null | undefined): uid is string => typeof uid === 'string' && uid.length > 0),
      ),
    ];
    const users =
      userIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
    const userNameById = new Map(users.map((u) => [u.id, u.name]));
    const statusHistory = history.map(
      (h: {
        id: string;
        fromStatus: string | null;
        toStatus: string;
        userId: string | null;
        note: string | null;
        createdAt: string | Date;
      }) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        createdAt: h.createdAt,
        userId: h.userId,
        userName: h.userId ? userNameById.get(h.userId) ?? null : null,
      }),
    );

    return {
      company: {
        legalName: company.legalName,
        tradeName: company.tradeName,
        cnpj: company.cnpj,
        phone: company.phone,
        address: company.address,
        city: company.city,
        state: company.state,
        logoUrl: company.logoUrl,
        termsText: company.serviceOrderTermsText,
      },
      order: {
        ...order,
        statusHistory,
      },
    };
  }

  async listEquipment(tenantSlug: string, customerId?: string) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    return db.customerEquipment.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        active: true,
      },
      orderBy: { label: 'asc' },
      take: 200,
    });
  }

  async listAssignees(tenantSlug: string) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const users = await db.user.findMany({
      where: {
        isActive: true,
        roles: {
          some: {
            name: { in: ['technician', 'manager', 'admin', 'seller'] },
          },
        },
      },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return users;
  }

  async createEquipment(
    tenantSlug: string,
    body: {
      customerId: string;
      label: string;
      equipmentType?: string | null;
      brand?: string | null;
      model?: string | null;
      serialNumber?: string | null;
      plateOrTag?: string | null;
      notes?: string | null;
    },
  ) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const customerId = String(body.customerId ?? '').trim();
    if (!customerId) throw new BadRequestException('Informe o cliente do equipamento.');
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new BadRequestException('Cliente inválido.');
    const label = String(body.label ?? '').trim();
    if (!label) throw new BadRequestException('Informe o nome do equipamento.');
    return db.customerEquipment.create({
      data: {
        customerId,
        label,
        equipmentType: body.equipmentType?.trim() || null,
        brand: body.brand?.trim() || null,
        model: body.model?.trim() || null,
        serialNumber: body.serialNumber?.trim() || null,
        plateOrTag: body.plateOrTag?.trim() || null,
        notes: body.notes?.trim() || null,
      },
    });
  }

  async updateEquipment(
    tenantSlug: string,
    id: string,
    body: {
      label?: string;
      equipmentType?: string | null;
      brand?: string | null;
      model?: string | null;
      serialNumber?: string | null;
      plateOrTag?: string | null;
      notes?: string | null;
      active?: boolean;
    },
  ) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const existing = await db.customerEquipment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Equipamento não encontrado.');
    return db.customerEquipment.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: String(body.label).trim() } : {}),
        ...(body.equipmentType !== undefined
          ? { equipmentType: body.equipmentType?.trim() || null }
          : {}),
        ...(body.brand !== undefined ? { brand: body.brand?.trim() || null } : {}),
        ...(body.model !== undefined ? { model: body.model?.trim() || null } : {}),
        ...(body.serialNumber !== undefined
          ? { serialNumber: body.serialNumber?.trim() || null }
          : {}),
        ...(body.plateOrTag !== undefined
          ? { plateOrTag: body.plateOrTag?.trim() || null }
          : {}),
        ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
        ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
      },
    });
  }

  /** Resumo para relatório de serviços realizados + aging. */
  async summaryReport(
    tenantSlug: string,
    opts: { from?: string; to?: string },
  ) {
    await this.assertCompanyModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.ServiceOrderWhereInput = {};
    if (opts.from || opts.to) {
      where.openedAt = {};
      if (opts.from) {
        const d = new Date(opts.from);
        d.setHours(0, 0, 0, 0);
        where.openedAt.gte = d;
      }
      if (opts.to) {
        const d = new Date(opts.to);
        d.setHours(23, 59, 59, 999);
        where.openedAt.lte = d;
      }
    }
    const rows = await db.serviceOrder.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        assignedTo: { select: { name: true } },
        items: true,
        sale: { select: { total: true, number: true } },
      },
      orderBy: { openedAt: 'desc' },
      take: 2000,
    });
    const now = Date.now();
    const openStatuses = new Set<ServiceOrderStatus>([
      ServiceOrderStatus.DRAFT,
      ServiceOrderStatus.QUOTE,
      ServiceOrderStatus.APPROVED,
      ServiceOrderStatus.IN_PROGRESS,
      ServiceOrderStatus.WAITING_PARTS,
      ServiceOrderStatus.READY,
      ServiceOrderStatus.DELIVERED,
    ]);
    let billedCount = 0;
    let billedTotal = 0;
    const byTechnician: Record<string, { count: number; total: number }> = {};
    const aging: Array<{
      id: string;
      number: number;
      status: string;
      customerName: string;
      daysOpen: number;
      promisedAt: string | null;
      overdue: boolean;
    }> = [];

    for (const r of rows) {
      const itemsTotal = r.items.reduce((s, it) => s + Number(it.totalLine), 0);
      const tech = r.assignedTo?.name ?? 'Sem técnico';
      if (!byTechnician[tech]) byTechnician[tech] = { count: 0, total: 0 };
      byTechnician[tech].count += 1;
      byTechnician[tech].total += itemsTotal;
      if (r.status === ServiceOrderStatus.BILLED) {
        billedCount += 1;
        billedTotal += r.sale ? Number(r.sale.total) : itemsTotal;
      }
      if (openStatuses.has(r.status)) {
        const daysOpen = Math.floor((now - r.openedAt.getTime()) / 86_400_000);
        const overdue =
          Boolean(r.promisedAt && r.promisedAt.getTime() < now) ||
          (r.status === ServiceOrderStatus.READY && daysOpen >= 3);
        aging.push({
          id: r.id,
          number: r.number,
          status: r.status,
          customerName: r.customer.name,
          daysOpen,
          promisedAt: r.promisedAt?.toISOString() ?? null,
          overdue,
        });
      }
    }

    return {
      from: opts.from ?? null,
      to: opts.to ?? null,
      totalOrders: rows.length,
      billedCount,
      billedTotal: roundMoney2(billedTotal),
      ticketAverage: billedCount ? roundMoney2(billedTotal / billedCount) : 0,
      byTechnician: Object.entries(byTechnician).map(([name, v]) => ({
        name,
        count: v.count,
        total: roundMoney2(v.total),
      })),
      aging: aging.sort((a, b) => b.daysOpen - a.daysOpen),
      orders: rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        type: r.type,
        openedAt: r.openedAt,
        customerName: r.customer.name,
        assignedToName: r.assignedTo?.name ?? null,
        itemsTotal: roundMoney2(r.items.reduce((s, it) => s + Number(it.totalLine), 0)),
        saleNumber: r.sale?.number ?? null,
        saleTotal: r.sale ? Number(r.sale.total) : null,
      })),
    };
  }
}
