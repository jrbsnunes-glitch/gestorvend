import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillStatus,
  PaymentMethod,
  Prisma,
  SaleSource,
  SaleStatus,
  StockMovementSource,
  StockMovementType,
  ActivityLogAction,
  UserPermissionCode,
} from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UserPermissionsService } from '../users/user-permissions.service';

export type CreateSaleInput = {
  tenantSlug: string;
  userId: string;
  userRoles: string[];
  permissionPassword?: string;
  customerId?: string | null;
  notes?: string | null;
  discount?: string | number;
  /** Origem da venda (PDV físico, WhatsApp via GestorVendChat, etc.). */
  source?: SaleSource;
  /** Referência externa (ex.: ID do pedido no GestorVendChat) para conciliação. */
  externalRef?: string | null;
  items: Array<{
    variantId: string;
    quantity: string | number;
    unitPrice: string | number;
    discount?: string | number;
  }>;
  payments: Array<{
    method: PaymentMethod;
    amount: string | number;
    installments?: number;
  }>;
};

const MONEY_EPS = 0.02;

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Garante que a soma dos pagamentos gravada = total da venda.
 * Troco em dinheiro: abate o excedente dos lançamentos CASH da direita para a esquerda.
 */
export function normalizePaymentsToSaleTotal(
  payments: CreateSaleInput['payments'],
  total: number,
): Array<{ method: PaymentMethod; amount: number; installments: number }> {
  for (const p of payments) {
    if (p.method === PaymentMethod.EXPENSE) {
      throw new BadRequestException('Forma de pagamento “Despesas” não se aplica a vendas.');
    }
  }
  const normalized = payments.map((p) => ({
    method: p.method,
    amount: roundMoney2(Number(p.amount)),
    installments: Math.max(1, p.installments ?? 1),
  }));

  let paySum = normalized.reduce((s, p) => s + p.amount, 0);
  if (paySum + MONEY_EPS < total) {
    throw new BadRequestException('Pagamento insuficiente para o total da venda');
  }

  let excess = roundMoney2(paySum - total);
  if (excess > MONEY_EPS) {
    let toTrim = excess;
    for (let i = normalized.length - 1; i >= 0 && toTrim > MONEY_EPS; i--) {
      if (normalized[i].method !== PaymentMethod.CASH) continue;
      const cur = normalized[i].amount;
      if (cur <= MONEY_EPS) continue;
      const cut = roundMoney2(Math.min(cur, toTrim));
      normalized[i].amount = roundMoney2(cur - cut);
      toTrim = roundMoney2(toTrim - cut);
    }
    if (toTrim > MONEY_EPS) {
      throw new BadRequestException(
        'Valor pago a maior: o troco só pode ser abatido em dinheiro. Ajuste cartão, Pix, crediário ou outro.',
      );
    }
  }

  paySum = normalized.reduce((s, p) => s + p.amount, 0);
  const drift = roundMoney2(total - paySum);
  if (Math.abs(drift) > MONEY_EPS) {
    for (let i = normalized.length - 1; i >= 0; i--) {
      if (normalized[i].method !== PaymentMethod.CASH) continue;
      normalized[i].amount = roundMoney2(normalized[i].amount + drift);
      break;
    }
    paySum = normalized.reduce((s, p) => s + p.amount, 0);
  }

  if (Math.abs(paySum - total) > MONEY_EPS) {
    throw new BadRequestException('Soma dos pagamentos difere do total da venda');
  }

  for (const p of normalized) {
    if (p.amount < -MONEY_EPS) {
      throw new BadRequestException('Valor de pagamento inválido após troco');
    }
  }

  return normalized;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly permissions: UserPermissionsService,
  ) {}

  async create(input: CreateSaleInput) {
    const db = await this.tenantPrisma.getClient(input.tenantSlug);

    const discount = Number(input.discount ?? 0);
    if (discount < 0) throw new BadRequestException('Desconto inválido');

    if (discount > 0) {
      await this.permissions.assertPermission(
        input.tenantSlug,
        input.userId,
        input.userRoles,
        UserPermissionCode.SALE_DISCOUNT,
        input.permissionPassword,
      );
    }

    let subtotal = 0;
    for (const it of input.items) {
      const q = Number(it.quantity);
      const p = Number(it.unitPrice);
      const d = Number(it.discount ?? 0);
      if (q <= 0) throw new BadRequestException('Quantidade inválida');
      subtotal += q * p - d;
    }
    const total = Math.max(0, subtotal - discount);
    if (!input.payments?.length) {
      throw new BadRequestException('Informe ao menos uma forma de pagamento');
    }
    const paymentsNorm = normalizePaymentsToSaleTotal(input.payments, total);

    const defaultLoc = await db.stockLocation.findFirst({
      where: { isDefault: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!defaultLoc) {
      throw new BadRequestException('Cadastre um local de estoque padrão');
    }

    return db.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          status: SaleStatus.COMPLETED,
          source: input.source ?? SaleSource.PDV,
          externalRef: input.externalRef ?? null,
          customerId: input.customerId ?? null,
          userId: input.userId,
          subtotal: String(subtotal.toFixed(2)),
          discount: String(discount.toFixed(2)),
          total: String(total.toFixed(2)),
          notes: input.notes ?? null,
          items: {
            create: input.items.map((it) => {
              const q = Number(it.quantity);
              const p = Number(it.unitPrice);
              const d = Number(it.discount ?? 0);
              const line = q * p - d;
              return {
                variantId: it.variantId,
                quantity: String(q),
                unitPrice: String(p),
                discount: String(d),
                totalLine: String(line.toFixed(2)),
              };
            }),
          },
          payments: {
            create: paymentsNorm.map((p) => ({
              method: p.method,
              amount: String(p.amount.toFixed(2)),
              installments: p.installments,
            })),
          },
        },
        include: { items: true, payments: true },
      });

      for (const it of input.items) {
        const q = Number(it.quantity);
        const bal = await tx.stockBalance.findUnique({
          where: {
            variantId_locationId: { variantId: it.variantId, locationId: defaultLoc.id },
          },
        });
        const current = bal ? Number(bal.quantity) : 0;
        if (current < q) {
          throw new BadRequestException(`Estoque insuficiente para o item ${it.variantId}`);
        }
        const next = current - q;
        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: { variantId: it.variantId, locationId: defaultLoc.id },
          },
          create: {
            variantId: it.variantId,
            locationId: defaultLoc.id,
            quantity: String(next),
          },
          update: { quantity: String(next) },
        });
        await tx.stockMovement.create({
          data: {
            type: StockMovementType.OUT,
            source: StockMovementSource.SALE,
            variantId: it.variantId,
            locationId: defaultLoc.id,
            quantity: String(q),
            reference: `Venda ${sale.number}`,
            userId: input.userId,
          },
        });
      }

      const credit = paymentsNorm.filter((p) => p.method === PaymentMethod.CREDIT);
      if (credit.length) {
        const creditTotal = credit.reduce((s, p) => s + p.amount, 0);
        const installments = Math.max(1, credit[0].installments ?? 1);
        const parcel = creditTotal / installments;
        const due = new Date();
        for (let i = 0; i < installments; i++) {
          const d = new Date(due);
          d.setMonth(d.getMonth() + i);
          const parcelStr = String(parcel.toFixed(2));
          await tx.accountReceivable.create({
            data: {
              customerId: input.customerId ?? null,
              saleId: sale.id,
              description: `Parcela ${i + 1}/${installments} — venda #${sale.number}`,
              amount: parcelStr,
              amountRemaining: parcelStr,
              dueDate: d,
              status: BillStatus.OPEN,
            },
          });
        }
      }

      return sale;
    }).then((sale) => {
      this.activityLog.record({
        tenantSlug: input.tenantSlug,
        userId: input.userId,
        action: ActivityLogAction.RECEIPT,
        summary: `Gerou cupom — venda #${sale.number} (R$ ${Number(sale.total).toFixed(2)})`,
        entityType: 'sale',
        entityRef: `#${sale.number}`,
      });
      return sale;
    });
  }

  /**
   * Remove uma linha de item de uma venda concluída (mínimo duas linhas antes),
   * recalcula totais e rebalanceia pagamentos (mesma lógica de troco só em dinheiro).
   * Não permite com pagamento CREDIÁRIO nesta primeira versão.
   */
  async removeSaleItem(tenantSlug: string, saleId: string, saleItemId: string, userId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    return db.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: {
          items: true,
          payments: true,
        },
      });
      if (!sale) throw new NotFoundException('Venda não encontrada');
      if (sale.status !== SaleStatus.COMPLETED) {
        throw new BadRequestException('Só é possível retirar item de venda finalizada.');
      }
      if (sale.items.length < 2) {
        throw new BadRequestException(
          'A venda tem apenas um item. Use “Cancelar venda” integral para estornar estoque.',
        );
      }

      const hasCredit = sale.payments.some((p) => p.method === PaymentMethod.CREDIT);
      if (hasCredit) {
        throw new BadRequestException(
          'Remoção de item automática não disponível quando há crediário. Cancele a venda inteira ou ajuste no financeiro.',
        );
      }

      const victim = sale.items.find((it) => it.id === saleItemId);
      if (!victim) {
        throw new BadRequestException('Item não encontrado nesta venda.');
      }

      const defaultLoc = await tx.stockLocation.findFirst({
        where: { isDefault: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!defaultLoc) throw new BadRequestException('Local padrão não encontrado');

      const qty = Number(victim.quantity);
      const bal = await tx.stockBalance.findUnique({
        where: {
          variantId_locationId: { variantId: victim.variantId, locationId: defaultLoc.id },
        },
      });
      const currentQty = bal ? Number(bal.quantity) : 0;
      await tx.stockBalance.upsert({
        where: {
          variantId_locationId: { variantId: victim.variantId, locationId: defaultLoc.id },
        },
        create: {
          variantId: victim.variantId,
          locationId: defaultLoc.id,
          quantity: String(currentQty + qty),
        },
        update: { quantity: String(currentQty + qty) },
      });
      await tx.stockMovement.create({
        data: {
          type: StockMovementType.IN,
          source: StockMovementSource.OTHER,
          variantId: victim.variantId,
          locationId: defaultLoc.id,
          quantity: String(qty),
          reference: `Estorno linha · venda #${sale.number}`,
          userId,
        },
      });

      await tx.saleItem.delete({ where: { id: saleItemId } });

      const remaining = sale.items.filter((it) => it.id !== saleItemId);
      const newSubtotal = roundMoney2(
        remaining.reduce((s, it) => s + Number(it.totalLine), 0),
      );
      const disc = Number(sale.discount);
      let newTotal = roundMoney2(newSubtotal - disc);
      if (newTotal < 0) {
        throw new BadRequestException(
          'Total da venda ficaria negativo com o desconto atual; reduza o desconto primeiro.',
        );
      }

      const payInput = sale.payments.map((p) => ({
        method: p.method as PaymentMethod,
        amount: Number(p.amount),
        installments: Math.max(1, p.installments ?? 1),
      }));

      let payNorm: ReturnType<typeof normalizePaymentsToSaleTotal>;
      try {
        payNorm = normalizePaymentsToSaleTotal(payInput, newTotal);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Não foi possível rebalancear os pagamentos.';
        throw new BadRequestException(msg);
      }

      await tx.salePayment.deleteMany({ where: { saleId: sale.id } });
      await tx.salePayment.createMany({
        data: payNorm.map((p) => ({
          saleId: sale.id,
          method: p.method,
          amount: String(p.amount.toFixed(2)),
          installments: p.installments,
        })),
      });

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          subtotal: String(newSubtotal.toFixed(2)),
          total: String(newTotal.toFixed(2)),
        },
        include: {
          customer: true,
          items: { include: { variant: { include: { product: true } } } },
          payments: true,
        },
      });

      return updated;
    });
  }

  async findById(tenantSlug: string, saleId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        customer: true,
        user: { select: { id: true, name: true, email: true } },
        fiscalDocument: true,
        items: { include: { variant: { include: { product: true } } } },
        payments: true,
      },
    });
    if (!sale) {
      throw new NotFoundException('Venda não encontrada');
    }
    return sale;
  }

  async list(tenantSlug: string, from?: string, to?: string, customerId?: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.SaleWhereInput = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (customerId != null && String(customerId).trim() !== '') {
      where.customerId = String(customerId).trim();
    }
    const hasDateFilter = Boolean(from || to);
    return db.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // Sem filtro: últimas 100 (lista geral). Com período: até 5000 (ex.: PDV "vendas hoje").
      take: hasDateFilter ? 5000 : 100,
      include: {
        customer: true,
        fiscalDocument: true,
        items: { include: { variant: { include: { product: true } } } },
        payments: true,
      },
    });
  }

  async cancel(
    tenantSlug: string,
    saleId: string,
    userId: string,
    userRoles: string[],
    permissionPassword?: string,
  ) {
    await this.permissions.assertPermission(
      tenantSlug,
      userId,
      userRoles,
      UserPermissionCode.SALE_CANCEL,
      permissionPassword,
    );

    const db = await this.tenantPrisma.getClient(tenantSlug);
    return db.$transaction(async (tx) => {
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id: saleId },
        include: { items: true },
      });
      if (sale.status === SaleStatus.CANCELLED) {
        throw new BadRequestException('Venda já cancelada');
      }

      const defaultLoc = await tx.stockLocation.findFirst({
        where: { isDefault: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!defaultLoc) throw new BadRequestException('Local padrão não encontrado');

      for (const it of sale.items) {
        const q = Number(it.quantity);
        const bal = await tx.stockBalance.findUnique({
          where: {
            variantId_locationId: { variantId: it.variantId, locationId: defaultLoc.id },
          },
        });
        const current = bal ? Number(bal.quantity) : 0;
        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: { variantId: it.variantId, locationId: defaultLoc.id },
          },
          create: {
            variantId: it.variantId,
            locationId: defaultLoc.id,
            quantity: String(current + q),
          },
          update: { quantity: String(current + q) },
        });
        await tx.stockMovement.create({
          data: {
            type: StockMovementType.IN,
            source: StockMovementSource.OTHER,
            variantId: it.variantId,
            locationId: defaultLoc.id,
            quantity: String(q),
            reference: `Estorno venda #${sale.number}`,
            userId,
          },
        });
      }

      await tx.accountReceivable.deleteMany({ where: { saleId } });

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: { status: SaleStatus.CANCELLED },
      });

      return updated;
    }).then((sale) => {
      this.activityLog.record({
        tenantSlug,
        userId,
        action: ActivityLogAction.UPDATE,
        summary: `Cancelou venda #${sale.number}`,
        entityType: 'sale',
        entityRef: `#${sale.number}`,
      });
      return sale;
    });
  }

  /** Libera novo PDV/caixa quando a pendência fiscal da venda foi resolvida manualmente (gerente). */
  async clearFiscalIntegrationError(tenantSlug: string, saleId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await db.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Venda não encontrada');
    return db.sale.update({
      where: { id: saleId },
      data: { fiscalIntegrationError: null },
    });
  }
}
