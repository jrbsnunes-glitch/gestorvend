import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityLogAction,
  CashSessionStatus,
  CreditKind,
  PaymentMethod,
  Prisma,
  SaleReservationStatus,
  SaleSource,
  StockLocationKind,
  StockMovementSource,
  StockMovementType,
} from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { CustomerCreditService } from '../catalog/customer-credit.service';
import { CompanyService } from '../company/company.service';
import { resolveSaleStockQuantity } from '../common/product-conversion.util';
import {
  ensureReservationLocation,
} from '../inventory/stock-location.util';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { normalizePaymentsToSaleTotal, SalesService } from '../sales/sales.service';

const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

type TenantTx = Prisma.TransactionClient;

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isCreditLike(method: PaymentMethod): boolean {
  return method === PaymentMethod.CREDIT || method === PaymentMethod.REQUISITION;
}

const reservationInclude = {
  customer: { select: { id: true, name: true, document: true, phone: true } },
  user: { select: { id: true, name: true } },
  sale: { select: { id: true, number: true, status: true } },
  items: {
    include: {
      variant: { include: { product: { select: { name: true, isService: true, controlNumber: true } } } },
    },
  },
  payments: { include: { paymentForm: { select: { id: true, name: true, kind: true } } } },
} as const;

export type ReservationLineInput = {
  variantId: string;
  quantity: number | string;
  unitPrice: number | string;
  discount?: number | string;
};

export type ReservationPaymentInput = {
  method?: PaymentMethod;
  amount: number | string;
  installments?: number;
  paymentFormId?: string | null;
};

export type UpsertReservationInput = {
  tenantSlug: string;
  userId: string;
  userRoles: string[];
  customerId?: string | null;
  notes?: string | null;
  items: ReservationLineInput[];
  payments: ReservationPaymentInput[];
};

type StockMoveLine = {
  stockVariantId: string;
  stockQty: number;
  productName: string;
};

@Injectable()
export class SalesReservationsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sales: SalesService,
    private readonly customerCredit: CustomerCreditService,
    private readonly company: CompanyService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async list(tenantSlug: string, status?: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    await this.expireOverdue(db, tenantSlug);
    const where: Prisma.SaleReservationWhereInput = {};
    const st = String(status ?? '').trim().toUpperCase();
    if (st && Object.values(SaleReservationStatus).includes(st as SaleReservationStatus)) {
      where.status = st as SaleReservationStatus;
    }
    return db.saleReservation.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: reservationInclude,
    });
  }

  async getOne(tenantSlug: string, id: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.saleReservation.findUnique({
      where: { id },
      include: reservationInclude,
    });
    if (!row) throw new NotFoundException('Reserva não encontrada');
    if (row.status === SaleReservationStatus.OPEN && row.expiresAt.getTime() <= Date.now()) {
      await this.expireOne(db, tenantSlug, row.id, row.userId);
      return db.saleReservation.findUniqueOrThrow({
        where: { id },
        include: reservationInclude,
      });
    }
    return row;
  }

  async create(input: UpsertReservationInput) {
    const db = await this.tenantPrisma.getClient(input.tenantSlug);
    const prepared = await this.preparePayload(db, input);
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);

    const created = await db.$transaction(async (tx) => {
      const { defaultLoc, reservaLoc } = await this.locations(tx);
      const row = await tx.saleReservation.create({
        data: {
          status: SaleReservationStatus.OPEN,
          customerId: prepared.customerId,
          userId: input.userId,
          subtotal: String(prepared.subtotal.toFixed(2)),
          discount: '0',
          total: String(prepared.total.toFixed(2)),
          notes: prepared.notes,
          expiresAt,
          items: {
            create: prepared.items.map((it) => ({
              variantId: it.variantId,
              quantity: String(it.quantity),
              unitPrice: String(it.unitPrice),
              discount: String(it.discount),
              totalLine: String(it.totalLine.toFixed(2)),
            })),
          },
          payments: {
            create: prepared.payments.map((p) => ({
              method: p.method,
              amount: String(p.amount.toFixed(2)),
              installments: p.installments,
              paymentFormId: p.paymentFormId,
            })),
          },
        },
        include: reservationInclude,
      });
      await this.transferLines(
        tx,
        defaultLoc.id,
        reservaLoc.id,
        prepared.stockLines,
        input.userId,
        `Reserva #${row.number}`,
        true,
      );
      return row;
    });

    this.activityLog.record({
      tenantSlug: input.tenantSlug,
      userId: input.userId,
      action: ActivityLogAction.CREATE,
      summary: `Criou reserva de venda #${created.number}`,
      entityType: 'saleReservation',
      entityRef: `#${created.number}`,
    });
    return created;
  }

  async update(id: string, input: UpsertReservationInput) {
    const db = await this.tenantPrisma.getClient(input.tenantSlug);
    const existing = await this.requireOpen(db, input.tenantSlug, id);
    const prepared = await this.preparePayload(db, input);

    const updated = await db.$transaction(async (tx) => {
      const { defaultLoc, reservaLoc } = await this.locations(tx);
      const oldLines = await this.expandStockLines(
        tx,
        existing.items.map((it) => ({
          variantId: it.variantId,
          quantity: Number(it.quantity),
        })),
      );
      await this.transferLines(
        tx,
        reservaLoc.id,
        defaultLoc.id,
        oldLines,
        input.userId,
        `Estorno reserva #${existing.number} (edição)`,
        false,
      );
      await tx.saleReservationItem.deleteMany({ where: { reservationId: id } });
      await tx.saleReservationPayment.deleteMany({ where: { reservationId: id } });
      const row = await tx.saleReservation.update({
        where: { id },
        data: {
          customerId: prepared.customerId,
          notes: prepared.notes,
          subtotal: String(prepared.subtotal.toFixed(2)),
          total: String(prepared.total.toFixed(2)),
          items: {
            create: prepared.items.map((it) => ({
              variantId: it.variantId,
              quantity: String(it.quantity),
              unitPrice: String(it.unitPrice),
              discount: String(it.discount),
              totalLine: String(it.totalLine.toFixed(2)),
            })),
          },
          payments: {
            create: prepared.payments.map((p) => ({
              method: p.method,
              amount: String(p.amount.toFixed(2)),
              installments: p.installments,
              paymentFormId: p.paymentFormId,
            })),
          },
        },
        include: reservationInclude,
      });
      await this.transferLines(
        tx,
        defaultLoc.id,
        reservaLoc.id,
        prepared.stockLines,
        input.userId,
        `Reserva #${row.number} (edição)`,
        true,
      );
      return row;
    });

    this.activityLog.record({
      tenantSlug: input.tenantSlug,
      userId: input.userId,
      action: ActivityLogAction.UPDATE,
      summary: `Editou reserva de venda #${updated.number}`,
      entityType: 'saleReservation',
      entityRef: `#${updated.number}`,
    });
    return updated;
  }

  async cancel(tenantSlug: string, id: string, userId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const existing = await this.requireOpen(db, tenantSlug, id);
    const cancelled = await db.$transaction(async (tx) => {
      const { defaultLoc, reservaLoc } = await this.locations(tx);
      const lines = await this.expandStockLines(
        tx,
        existing.items.map((it) => ({
          variantId: it.variantId,
          quantity: Number(it.quantity),
        })),
      );
      await this.transferLines(
        tx,
        reservaLoc.id,
        defaultLoc.id,
        lines,
        userId,
        `Cancelamento reserva #${existing.number}`,
        false,
      );
      return tx.saleReservation.update({
        where: { id },
        data: {
          status: SaleReservationStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        include: reservationInclude,
      });
    });
    this.activityLog.record({
      tenantSlug,
      userId,
      action: ActivityLogAction.UPDATE,
      summary: `Cancelou reserva de venda #${cancelled.number}`,
      entityType: 'saleReservation',
      entityRef: `#${cancelled.number}`,
    });
    return cancelled;
  }

  async confirm(
    tenantSlug: string,
    id: string,
    userId: string,
    userRoles: string[],
    cashSessionId: string,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const existing = await this.requireOpen(db, tenantSlug, id);
    const sessionId = String(cashSessionId ?? '').trim();
    if (!sessionId) {
      throw new BadRequestException('Selecione o caixa onde a venda será concretizada.');
    }
    const session = await db.cashRegisterSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!session) throw new NotFoundException('Caixa não encontrado.');
    if (session.status !== CashSessionStatus.OPEN) {
      throw new BadRequestException('O caixa escolhido não está aberto.');
    }
    const isManager = userRoles.includes('admin') || userRoles.includes('manager');
    if (session.userId !== userId && !isManager) {
      throw new ForbiddenException('Somente gerente pode confirmar a reserva em caixa de outro operador.');
    }

    const { defaultLoc, reservaLoc } = await this.locations(db);
    const stockLines = await this.expandStockLines(
      db,
      existing.items.map((it) => ({
        variantId: it.variantId,
        quantity: Number(it.quantity),
      })),
    );

    await db.$transaction(async (tx) => {
      await this.transferLines(
        tx,
        reservaLoc.id,
        defaultLoc.id,
        stockLines,
        userId,
        `Confirmação reserva #${existing.number}`,
        false,
      );
    });

    try {
      const sale = await this.sales.create({
        tenantSlug,
        userId,
        userRoles,
        customerId: existing.customerId,
        notes: existing.notes,
        cashSessionId: session.id,
        source: SaleSource.PDV,
        deductStock: true,
        items: existing.items.map((it) => ({
          variantId: it.variantId,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          discount: Number(it.discount),
        })),
        payments: existing.payments.map((p) => ({
          method: p.method,
          amount: Number(p.amount),
          installments: p.installments,
          paymentFormId: p.paymentFormId,
        })),
      });

      const confirmed = await db.saleReservation.update({
        where: { id },
        data: {
          status: SaleReservationStatus.CONFIRMED,
          saleId: sale.id,
          confirmedAt: new Date(),
        },
        include: reservationInclude,
      });
      this.activityLog.record({
        tenantSlug,
        userId,
        action: ActivityLogAction.UPDATE,
        summary: `Confirmou reserva #${existing.number} como venda #${sale.number}`,
        entityType: 'saleReservation',
        entityRef: `#${existing.number}`,
      });
      return { reservation: confirmed, sale };
    } catch (err) {
      try {
        await db.$transaction(async (tx) => {
          await this.transferLines(
            tx,
            defaultLoc.id,
            reservaLoc.id,
            stockLines,
            userId,
            `Reverte confirmação reserva #${existing.number}`,
            true,
          );
        });
      } catch {
        /* estoque já pode ter sido vendido no PDV — a falha original segue */
      }
      throw err;
    }
  }

  async expireOverdueForTenant(tenantSlug: string): Promise<number> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    return this.expireOverdue(db, tenantSlug);
  }

  async receiptPayload(tenantSlug: string, id: string) {
    const reservation = await this.getOne(tenantSlug, id);
    const company = await this.company.getOrCreate(tenantSlug);
    return { reservation, company };
  }

  private async expireOverdue(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    tenantSlug: string,
  ): Promise<number> {
    const due = await db.saleReservation.findMany({
      where: {
        status: SaleReservationStatus.OPEN,
        expiresAt: { lte: new Date() },
      },
      select: { id: true, userId: true },
    });
    for (const row of due) {
      try {
        await this.expireOne(db, tenantSlug, row.id, row.userId);
      } catch {
        /* próximo ciclo tenta de novo */
      }
    }
    return due.length;
  }

  private async expireOne(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    tenantSlug: string,
    id: string,
    userId: string | null,
  ) {
    const existing = await db.saleReservation.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing || existing.status !== SaleReservationStatus.OPEN) return;
    await db.$transaction(async (tx) => {
      const { defaultLoc, reservaLoc } = await this.locations(tx);
      const lines = await this.expandStockLines(
        tx,
        existing.items.map((it) => ({
          variantId: it.variantId,
          quantity: Number(it.quantity),
        })),
      );
      await this.transferLines(
        tx,
        reservaLoc.id,
        defaultLoc.id,
        lines,
        userId,
        `Expiração reserva #${existing.number}`,
        false,
      );
      await tx.saleReservation.update({
        where: { id },
        data: {
          status: SaleReservationStatus.EXPIRED,
          cancelledAt: new Date(),
        },
      });
    });
    this.activityLog.record({
      tenantSlug,
      userId: userId ?? '',
      action: ActivityLogAction.UPDATE,
      summary: `Expirou reserva de venda #${existing.number} (24h)`,
      entityType: 'saleReservation',
      entityRef: `#${existing.number}`,
    });
  }

  private async requireOpen(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    tenantSlug: string,
    id: string,
  ) {
    const row = await db.saleReservation.findUnique({
      where: { id },
      include: reservationInclude,
    });
    if (!row) throw new NotFoundException('Reserva não encontrada');
    if (row.status === SaleReservationStatus.OPEN && row.expiresAt.getTime() <= Date.now()) {
      await this.expireOne(db, tenantSlug, row.id, row.userId);
      throw new BadRequestException('Esta reserva expirou (24h) e o estoque foi devolvido.');
    }
    if (row.status !== SaleReservationStatus.OPEN) {
      throw new BadRequestException('Só é possível alterar reserva em aberto.');
    }
    return row;
  }

  private async preparePayload(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    input: UpsertReservationInput,
  ) {
    if (!input.items?.length) {
      throw new BadRequestException('Inclua ao menos um produto na reserva.');
    }
    if (!input.payments?.length) {
      throw new BadRequestException('Informe ao menos uma forma de pagamento.');
    }

    const items: Array<{
      variantId: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      totalLine: number;
    }> = [];
    let subtotal = 0;
    for (const it of input.items) {
      const variantId = String(it.variantId ?? '').trim();
      const q = Number(it.quantity);
      const p = Number(it.unitPrice);
      const d = Number(it.discount ?? 0);
      if (!variantId) throw new BadRequestException('Produto inválido.');
      if (!(q > 0) || !Number.isFinite(q)) throw new BadRequestException('Quantidade inválida.');
      if (!(p >= 0) || !Number.isFinite(p)) throw new BadRequestException('Preço inválido.');
      if (d < 0) throw new BadRequestException('Desconto de item inválido.');
      const gross = roundMoney2(q * p);
      if (d > gross + 0.009) {
        throw new BadRequestException('Desconto de item não pode exceder o valor da linha.');
      }
      const totalLine = roundMoney2(gross - d);
      subtotal = roundMoney2(subtotal + totalLine);
      items.push({ variantId, quantity: q, unitPrice: p, discount: d, totalLine });
    }

    const formIds = [
      ...new Set(
        input.payments.map((p) => String(p.paymentFormId ?? '').trim()).filter(Boolean),
      ),
    ];
    const forms = formIds.length
      ? await db.paymentForm.findMany({ where: { id: { in: formIds } } })
      : [];
    const formById = new Map(forms.map((f) => [f.id, f]));

    const paymentsRaw = input.payments.map((p) => {
      const form = p.paymentFormId ? formById.get(String(p.paymentFormId).trim()) : undefined;
      if (p.paymentFormId && !form) {
        throw new BadRequestException('Forma de pagamento inválida ou inativa.');
      }
      if (form && !form.isActive) {
        throw new BadRequestException(`Forma de pagamento “${form.name}” está inativa.`);
      }
      const method = (form?.kind as PaymentMethod | undefined) ?? p.method;
      if (!method || method === PaymentMethod.EXPENSE) {
        throw new BadRequestException('Forma de pagamento inválida.');
      }
      return {
        method,
        amount: Number(p.amount),
        installments: Math.max(1, p.installments ?? 1),
        paymentFormId: form?.id ?? null,
      };
    });

    const payments = normalizePaymentsToSaleTotal(paymentsRaw, subtotal);
    const total = payments.reduce((s, p) => roundMoney2(s + p.amount), 0);
    const customerId = input.customerId?.trim() || null;
    const creditLike = payments.filter((p) => isCreditLike(p.method));
    if (creditLike.length && !customerId) {
      throw new BadRequestException(
        'Informe um cliente cadastrado para crediário ou requisição.',
      );
    }
    if (creditLike.length && customerId) {
      const byKind = new Map<PaymentMethod, number>();
      for (const p of creditLike) {
        byKind.set(p.method, roundMoney2((byKind.get(p.method) ?? 0) + p.amount));
      }
      for (const [method, amount] of byKind) {
        await this.customerCredit.assertAvailable(
          input.tenantSlug,
          customerId,
          method === PaymentMethod.CREDIT ? CreditKind.CREDIT : CreditKind.REQUISITION,
          amount,
        );
      }
    }

    const stockLines = await this.expandStockLines(db, items);
    return {
      customerId,
      notes: input.notes?.trim() || null,
      items,
      payments,
      subtotal,
      total: roundMoney2(total),
      stockLines,
    };
  }

  private async locations(db: {
    stockLocation: {
      findFirst: (args: unknown) => Promise<{ id: string; code: string; name: string } | null>;
      findUnique: (args: unknown) => Promise<{ id: string; code: string; name: string; kind: string } | null>;
      create: (args: unknown) => Promise<{ id: string; code: string; name: string; kind: string }>;
      update: (args: unknown) => Promise<{ id: string; code: string; name: string; kind: string }>;
    };
  }) {
    const defaultLoc = await db.stockLocation.findFirst({
      where: { isDefault: true, kind: { not: StockLocationKind.SALES_RESERVATION } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, code: true, name: true },
    } as never);
    if (!defaultLoc) {
      throw new BadRequestException('Cadastre um local de estoque padrão');
    }
    const reservaLoc = await ensureReservationLocation(db);
    if (reservaLoc.id === defaultLoc.id) {
      throw new BadRequestException(
        'O local Reserva não pode ser o local padrão. Defina outro local operacional como padrão.',
      );
    }
    return { defaultLoc, reservaLoc };
  }

  private async expandStockLines(
    tx: { productVariant: { findUnique: Function; findUniqueOrThrow: Function } },
    items: Array<{ variantId: string; quantity: number }>,
  ): Promise<StockMoveLine[]> {
    const out: StockMoveLine[] = [];
    for (const it of items) {
      const q = Number(it.quantity);
      if (q <= 0) continue;
      const soldVariant = await tx.productVariant.findUnique({
        where: { id: it.variantId },
        include: {
          product: {
            include: {
              recipe: { include: { items: true } },
              stockComponentVariant: { select: { product: { select: { name: true } } } },
            },
          },
        },
      });
      if (!soldVariant) {
        throw new BadRequestException('Produto / variação não encontrado.');
      }
      if (soldVariant.product.isService) continue;
      const recipeItems = soldVariant.product.recipe?.items ?? [];
      if (recipeItems.length > 0) {
        for (const ri of recipeItems) {
          const stockQty = Math.round(q * Number(ri.quantity) * 10_000) / 10_000;
          if (stockQty <= 0) continue;
          const ing = await tx.productVariant.findUnique({
            where: { id: ri.ingredientVariantId },
            include: { product: { select: { name: true } } },
          });
          out.push({
            stockVariantId: ri.ingredientVariantId,
            stockQty,
            productName: ing?.product.name ?? ri.ingredientVariantId,
          });
        }
        continue;
      }
      const componentId = soldVariant.product.stockComponentVariantId?.trim() || null;
      const stockQty = resolveSaleStockQuantity(
        q,
        soldVariant.product.conversion,
        Boolean(componentId),
        soldVariant.product.packItemQty != null ? Number(soldVariant.product.packItemQty) : null,
      );
      out.push({
        stockVariantId: componentId ?? it.variantId,
        stockQty,
        productName:
          soldVariant.product.stockComponentVariant?.product.name ?? soldVariant.product.name,
      });
    }
    return out;
  }

  private async transferLines(
    tx: TenantTx,
    fromId: string,
    toId: string,
    lines: StockMoveLine[],
    userId: string | null,
    reference: string,
    requireStock: boolean,
  ) {
    const ref = reference.slice(0, 500);
    for (const line of lines) {
      if (line.stockQty <= 0) continue;
      const fromBal = await tx.stockBalance.findUnique({
        where: {
          variantId_locationId: { variantId: line.stockVariantId, locationId: fromId },
        },
      });
      const currentFrom = fromBal ? Number(fromBal.quantity) : 0;
      if (requireStock && currentFrom + 1e-9 < line.stockQty) {
        throw new BadRequestException(
          `Estoque insuficiente de "${line.productName}": disponível ${currentFrom}, necessário ${line.stockQty}.`,
        );
      }
      const nextFrom = currentFrom - line.stockQty;
      await tx.stockBalance.upsert({
        where: {
          variantId_locationId: { variantId: line.stockVariantId, locationId: fromId },
        },
        create: {
          variantId: line.stockVariantId,
          locationId: fromId,
          quantity: String(nextFrom),
        },
        update: { quantity: String(nextFrom) },
      });
      const toBal = await tx.stockBalance.findUnique({
        where: {
          variantId_locationId: { variantId: line.stockVariantId, locationId: toId },
        },
      });
      const currentTo = toBal ? Number(toBal.quantity) : 0;
      await tx.stockBalance.upsert({
        where: {
          variantId_locationId: { variantId: line.stockVariantId, locationId: toId },
        },
        create: {
          variantId: line.stockVariantId,
          locationId: toId,
          quantity: String(currentTo + line.stockQty),
        },
        update: { quantity: String(currentTo + line.stockQty) },
      });
      await tx.stockMovement.create({
        data: {
          type: StockMovementType.OUT,
          source: StockMovementSource.TRANSFER,
          variantId: line.stockVariantId,
          locationId: fromId,
          quantity: String(line.stockQty),
          reference: ref,
          userId,
        },
      });
      await tx.stockMovement.create({
        data: {
          type: StockMovementType.IN,
          source: StockMovementSource.TRANSFER,
          variantId: line.stockVariantId,
          locationId: toId,
          quantity: String(line.stockQty),
          reference: ref,
          userId,
        },
      });
    }
  }
}
