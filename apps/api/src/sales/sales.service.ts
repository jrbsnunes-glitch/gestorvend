import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillStatus,
  PaymentMethod,
  Prisma,
  SaleSource,
  SaleStatus,
  StockMovementSource,
  StockMovementType,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type CreateSaleInput = {
  tenantSlug: string;
  userId: string;
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
function normalizePaymentsToSaleTotal(
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
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(input: CreateSaleInput) {
    const db = await this.tenantPrisma.getClient(input.tenantSlug);

    const discount = Number(input.discount ?? 0);
    if (discount < 0) throw new BadRequestException('Desconto inválido');

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
    });
  }

  async findById(tenantSlug: string, saleId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        customer: true,
        user: { select: { id: true, name: true, email: true } },
        items: { include: { variant: { include: { product: true } } } },
        payments: true,
      },
    });
    if (!sale) {
      throw new NotFoundException('Venda não encontrada');
    }
    return sale;
  }

  async list(tenantSlug: string, from?: string, to?: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.SaleWhereInput = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    const hasDateFilter = Boolean(from || to);
    return db.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // Sem filtro: últimas 100 (lista geral). Com período: até 5000 (ex.: PDV "vendas hoje").
      take: hasDateFilter ? 5000 : 100,
      include: {
        customer: true,
        items: { include: { variant: { include: { product: true } } } },
        payments: true,
      },
    });
  }

  async cancel(tenantSlug: string, saleId: string, userId: string) {
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

      return tx.sale.update({
        where: { id: saleId },
        data: { status: SaleStatus.CANCELLED },
      });
    });
  }
}
