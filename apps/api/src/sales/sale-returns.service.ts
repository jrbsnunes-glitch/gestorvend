import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillStatus,
  CashMovementType,
  CashSessionStatus,
  CreditKind,
  FiscalDocumentKind,
  FiscalDocumentStatus,
  PaymentMethod,
  Prisma,
  PrismaClient,
  SaleReturnFiscalAction,
  SaleReturnKind,
  SaleReturnRefundMethod,
  SaleSource,
  SaleStatus,
  StockMovementSource,
  StockMovementType,
  UserPermissionCode,
  ActivityLogAction,
} from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { CustomerCreditService } from '../catalog/customer-credit.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UserPermissionsService } from '../users/user-permissions.service';
import { getDefaultStockLocation, resolveSaleStockTarget, SalesService } from './sales.service';

const NFC_E_CANCEL_MS = 30 * 60 * 1000;
const NF_E_CANCEL_MS = 24 * 60 * 60 * 1000;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function returnLineAmount(soldQty: number, soldTotal: number, qty: number): number {
  if (!(soldQty > 0) || !(qty > 0)) return 0;
  return roundMoney((soldTotal * qty) / soldQty);
}

type Bucket = Record<'CASH' | 'CARD' | 'PIX' | 'CREDIT' | 'REQUISITION' | 'OTHER', number>;

function emptyBucket(): Bucket {
  return { CASH: 0, CARD: 0, PIX: 0, CREDIT: 0, REQUISITION: 0, OTHER: 0 };
}

export function allocateReturnByPayment(
  returnTotal: number,
  payments: Array<{ method: string; amount: number }>,
  saleTotal: number,
): Bucket {
  const bucket = emptyBucket();
  const base = saleTotal > 0 ? saleTotal : payments.reduce((s, p) => s + p.amount, 0);
  if (!(returnTotal > 0) || !(base > 0)) return bucket;
  const ratio = returnTotal / base;
  let assigned = 0;
  const rows = payments.map((p) => {
    const share = roundMoney(p.amount * ratio);
    assigned = roundMoney(assigned + share);
    return { method: p.method, share };
  });
  const drift = roundMoney(returnTotal - assigned);
  if (rows.length && Math.abs(drift) >= 0.01) {
    rows[rows.length - 1]!.share = roundMoney(rows[rows.length - 1]!.share + drift);
  }
  for (const row of rows) {
    const key = (row.method in bucket ? row.method : 'OTHER') as keyof Bucket;
    bucket[key] = roundMoney(bucket[key] + row.share);
  }
  return bucket;
}

export type CreateSaleReturnInput = {
  tenantSlug: string;
  userId: string;
  userRoles: string[];
  permissionPassword?: string;
  saleId: string;
  refundMethod: 'CASH' | 'CUSTOMER_CREDIT';
  notes?: string | null;
  items: Array<{ saleItemId: string; quantity: number }>;
  replacementItems?: Array<{ variantId: string; quantity: number; unitPrice: number }>;
  differenceMethod?: 'CASH' | 'PIX' | 'CARD' | 'REQUISITION' | 'OTHER';
};

@Injectable()
export class SaleReturnsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly permissions: UserPermissionsService,
    private readonly customerCredit: CustomerCreditService,
    private readonly activityLog: ActivityLogService,
    private readonly sales: SalesService,
  ) {}

  async preview(tenantSlug: string, saleId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await this.loadSale(db, saleId);
    const returned = returnedQtyByItem(sale.returns);
    const now = Date.now();
    const fiscal = describeFiscal(sale, now, true);
    return {
      saleId: sale.id,
      saleNumber: sale.number,
      saleTotal: Number(sale.total),
      customerId: sale.customerId,
      hasCustomer: Boolean(sale.customerId),
      items: sale.items.map((it) => {
        const sold = Number(it.quantity);
        const done = returned.get(it.id) ?? 0;
        return {
          saleItemId: it.id,
          variantId: it.variantId,
          name: it.variant.product.name,
          sku: it.variant.sku,
          taxUnit: it.variant.product.taxUnit,
          isService: Boolean(it.variant.product.isService),
          soldQty: sold,
          returnedQty: done,
          remainingQty: roundQty(Math.max(0, sold - done)),
          unitPrice: Number(it.unitPrice),
          totalLine: Number(it.totalLine),
        };
      }),
      payments: sale.payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
      fiscal,
    };
  }

  async create(input: CreateSaleReturnInput) {
    await this.permissions.assertPermission(
      input.tenantSlug,
      input.userId,
      input.userRoles,
      UserPermissionCode.SALE_RETURN,
      input.permissionPassword,
    );

    const db = await this.tenantPrisma.getClient(input.tenantSlug);
    const prepared = await db.$transaction(async (tx) => {
      const sale = await this.loadSale(tx, input.saleId);
      if (sale.status !== SaleStatus.COMPLETED) {
        throw new BadRequestException('Só é possível devolver itens de uma venda concluída.');
      }
      if (sale.source === SaleSource.RETURN) {
        throw new BadRequestException('Esta venda é uma NF-e de devolução e não aceita nova devolução.');
      }

      const returned = returnedQtyByItem(sale.returns);
      const lines: Array<{
        saleItemId: string;
        variantId: string;
        quantity: number;
        unitPrice: number;
        totalLine: number;
        isService: boolean;
      }> = [];
      for (const raw of input.items) {
        const item = sale.items.find((it) => it.id === raw.saleItemId);
        if (!item) throw new BadRequestException('Item não pertence a esta venda.');
        const qty = roundQty(Number(raw.quantity));
        if (!(qty > 0)) throw new BadRequestException('Informe a quantidade devolvida.');
        const sold = Number(item.quantity);
        const already = returned.get(item.id) ?? 0;
        if (qty > roundQty(sold - already) + 0.0001) {
          throw new BadRequestException(
            `Quantidade de “${item.variant.product.name}” passa do saldo devolvido (${roundQty(sold - already)}).`,
          );
        }
        lines.push({
          saleItemId: item.id,
          variantId: item.variantId,
          quantity: qty,
          unitPrice: Number(item.unitPrice),
          totalLine: returnLineAmount(sold, Number(item.totalLine), qty),
          isService: Boolean(item.variant.product.isService),
        });
      }
      if (!lines.length) throw new BadRequestException('Selecione ao menos um item.');

      const amount = roundMoney(lines.reduce((s, l) => s + l.totalLine, 0));
      if (!(amount > 0)) throw new BadRequestException('Valor da devolução inválido.');

      const fullReturn = sale.items.every((it) => {
        const add = lines.find((l) => l.saleItemId === it.id)?.quantity ?? 0;
        const done = (returned.get(it.id) ?? 0) + add;
        return done + 0.0001 >= Number(it.quantity);
      });

      if (sale.deductStock) {
        const defaultLoc = await getDefaultStockLocation(tx);
        if (!defaultLoc) throw new BadRequestException('Local padrão de estoque não encontrado.');
        for (const line of lines) {
          if (line.isService) continue;
          const { stockVariantId, stockQty } = await resolveSaleStockTarget(
            tx,
            line.variantId,
            line.quantity,
          );
          if (!(stockQty > 0)) continue;
          const bal = await tx.stockBalance.findUnique({
            where: {
              variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
            },
          });
          const current = bal ? Number(bal.quantity) : 0;
          await tx.stockBalance.upsert({
            where: {
              variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
            },
            create: {
              variantId: stockVariantId,
              locationId: defaultLoc.id,
              quantity: String(current + stockQty),
            },
            update: { quantity: String(current + stockQty) },
          });
          await tx.stockMovement.create({
            data: {
              type: StockMovementType.IN,
              source: StockMovementSource.RETURN,
              variantId: stockVariantId,
              locationId: defaultLoc.id,
              quantity: String(stockQty),
              reference: `Devolução venda #${sale.number}`.slice(0, 500),
              userId: input.userId,
            },
          });
        }
      }

      const bucket = allocateReturnByPayment(
        amount,
        sale.payments.map((p) => ({ method: String(p.method), amount: Number(p.amount) })),
        Number(sale.total),
      );
      const requisitionReduced = await reduceRequisitionTitles(tx, sale.id, bucket.REQUISITION);
      const requisitionLeftover = roundMoney(Math.max(0, bucket.REQUISITION - requisitionReduced));

      let creditRestored = 0;
      if (sale.customerId && bucket.CREDIT > 0) {
        await this.customerCredit.restoreCreditBalance(tx, sale.customerId, bucket.CREDIT);
        creditRestored = bucket.CREDIT;
      }

      const replacementItems = (input.replacementItems ?? []).filter((it) => Number(it.quantity) > 0);
      const replacementTotal = roundMoney(
        replacementItems.reduce((s, it) => s + roundMoney(Number(it.quantity) * Number(it.unitPrice)), 0),
      );
      const refundable = roundMoney(
        bucket.CASH + bucket.CARD + bucket.PIX + bucket.OTHER + requisitionLeftover,
      );
      const creditApplied = replacementTotal > 0 ? Math.min(refundable, replacementTotal) : 0;
      const leftover = roundMoney(refundable - creditApplied);

      const refundMethod =
        input.refundMethod === 'CUSTOMER_CREDIT'
          ? SaleReturnRefundMethod.CUSTOMER_CREDIT
          : SaleReturnRefundMethod.CASH;

      let cashRefund = 0;
      let cashSessionId: string | null = null;
      if (leftover > 0 && refundMethod === SaleReturnRefundMethod.CASH) {
        const session = await tx.cashRegisterSession.findFirst({
          where: { userId: input.userId, status: CashSessionStatus.OPEN },
          orderBy: { openedAt: 'desc' },
        });
        if (!session) {
          throw new BadRequestException(
            'Abra um caixa para devolver dinheiro. Ou escolha crédito do cliente.',
          );
        }
        cashSessionId = session.id;
        cashRefund = leftover;
        await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            type: CashMovementType.OUT,
            amount: leftover.toFixed(2),
            method: PaymentMethod.CASH,
            reason: `Devolução venda #${sale.number}`.slice(0, 500),
          },
        });
      } else if (leftover > 0 && refundMethod === SaleReturnRefundMethod.CUSTOMER_CREDIT) {
        if (!sale.customerId) {
          throw new BadRequestException('A venda não tem cliente para receber o crédito.');
        }
        await this.customerCredit.restoreCreditBalance(tx, sale.customerId, leftover);
        creditRestored = roundMoney(creditRestored + leftover);
      }

      const fiscalPlan = describeFiscal(sale, Date.now(), fullReturn);
      let fiscalAction: SaleReturnFiscalAction = SaleReturnFiscalAction.NONE;
      let fiscalMessage: string | null = fiscalPlan.message;
      let returnInvoiceSaleId: string | null = null;
      if (fiscalPlan.queueReturnNfe && sale.fiscalDocument?.accessKey) {
        const invoice = await tx.sale.create({
          data: {
            status: SaleStatus.COMPLETED,
            source: SaleSource.RETURN,
            customerId: sale.customerId,
            userId: input.userId,
            deductStock: false,
            subtotal: amount.toFixed(2),
            discount: 0,
            total: amount.toFixed(2),
            notes: `NF-e de devolução da venda #${sale.number}`,
            items: {
              create: lines.map((l) => ({
                variantId: l.variantId,
                quantity: String(l.quantity),
                unitPrice: String(l.unitPrice),
                discount: 0,
                totalLine: l.totalLine.toFixed(2),
              })),
            },
            payments: {
              create: [{ method: PaymentMethod.OTHER, amount: amount.toFixed(2) }],
            },
          },
        });
        await tx.fiscalDocument.create({
          data: {
            saleId: invoice.id,
            kind: FiscalDocumentKind.NF_E,
            status: FiscalDocumentStatus.QUEUED,
            finNFe: 4,
            refAccessKey: sale.fiscalDocument.accessKey,
          },
        });
        returnInvoiceSaleId = invoice.id;
        fiscalAction = SaleReturnFiscalAction.RETURN_NFE_QUEUED;
        fiscalMessage =
          'NF-e de devolução enfileirada com a chave da nota original. A nota original permanece autorizada.';
      } else if (fullReturn && sale.fiscalDocument && !sale.fiscalDocument.accessKey) {
        if (
          sale.fiscalDocument.status === FiscalDocumentStatus.QUEUED ||
          sale.fiscalDocument.status === FiscalDocumentStatus.DRAFT ||
          sale.fiscalDocument.status === FiscalDocumentStatus.ERROR ||
          sale.fiscalDocument.status === FiscalDocumentStatus.REJECTED
        ) {
          await tx.fiscalDocument.update({
            where: { id: sale.fiscalDocument.id },
            data: { status: FiscalDocumentStatus.CANCELLED, lastError: 'Devolução total antes da autorização.' },
          });
          fiscalMessage = 'Documento fiscal ainda não autorizado foi cancelado na fila.';
        }
      }

      const created = await tx.saleReturn.create({
        data: {
          saleId: sale.id,
          kind: replacementItems.length ? SaleReturnKind.EXCHANGE : SaleReturnKind.RETURN,
          refundMethod,
          amount: amount.toFixed(2),
          creditApplied: creditApplied.toFixed(2),
          cashRefundAmount: cashRefund.toFixed(2),
          creditRestoredAmount: creditRestored.toFixed(2),
          requisitionReduced: requisitionReduced.toFixed(2),
          notes: input.notes?.trim() || null,
          fiscalAction,
          fiscalMessage,
          userId: input.userId,
          cashSessionId,
          returnInvoiceSaleId,
          items: {
            create: lines.map((l) => ({
              saleItemId: l.saleItemId,
              quantity: String(l.quantity),
              unitPrice: String(l.unitPrice),
              totalLine: l.totalLine.toFixed(2),
            })),
          },
        },
      });

      return {
        saleNumber: sale.number,
        customerId: sale.customerId,
        createdId: created.id,
        creditApplied,
        replacementItems,
        replacementTotal,
        cancelFiscalDocumentId: fiscalPlan.cancelOriginal ? sale.fiscalDocument?.id ?? null : null,
      };
    });

    let replacementSale: { id: string; number: number } | null = null;
    let replacementError: string | null = null;
    if (prepared.replacementItems.length && prepared.replacementTotal > 0) {
      const diff = roundMoney(prepared.replacementTotal - prepared.creditApplied);
      const payments: Array<{ method: PaymentMethod; amount: number }> = [];
      if (prepared.creditApplied > 0) {
        payments.push({ method: PaymentMethod.OTHER, amount: prepared.creditApplied });
      }
      if (diff > 0) {
        const method = (input.differenceMethod ?? 'CASH') as PaymentMethod;
        payments.push({ method, amount: diff });
      }
      try {
        const sale = await this.sales.create({
          tenantSlug: input.tenantSlug,
          userId: input.userId,
          userRoles: input.userRoles,
          permissionPassword: input.permissionPassword,
          customerId: prepared.customerId,
          notes: `Troca da venda #${prepared.saleNumber}`,
          source: 'PDV',
          items: prepared.replacementItems.map((it) => ({
            variantId: it.variantId,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
          })),
          payments: payments.map((p) => ({
            method: p.method,
            amount: p.amount,
          })),
        });
        replacementSale = { id: sale.id, number: sale.number };
        await db.saleReturn.update({
          where: { id: prepared.createdId },
          data: { replacementSaleId: sale.id, kind: SaleReturnKind.EXCHANGE },
        });
      } catch (err) {
        replacementError = err instanceof Error ? err.message : 'Falha ao gravar a venda da troca.';
      }
    }

    const row = await db.saleReturn.findUniqueOrThrow({
      where: { id: prepared.createdId },
      include: { items: true, replacementSale: { select: { id: true, number: true } } },
    });

    this.activityLog.record({
      tenantSlug: input.tenantSlug,
      userId: input.userId,
      action: ActivityLogAction.CREATE,
      summary: `Devolução #${row.number} da venda #${prepared.saleNumber}`,
      entityType: 'sale_return',
      entityRef: `#${row.number}`,
    });

    return {
      return: row,
      replacementSale,
      replacementError,
      cancelFiscalDocumentId: prepared.cancelFiscalDocumentId,
    };
  }

  async markFiscal(tenantSlug: string, returnId: string, action: SaleReturnFiscalAction, message: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    return db.saleReturn.update({
      where: { id: returnId },
      data: { fiscalAction: action, fiscalMessage: message.slice(0, 500) },
    });
  }

  private async loadSale(
    db: Prisma.TransactionClient | PrismaClient,
    saleId: string,
  ): Promise<SaleLoaded> {
    const sale = await (db as PrismaClient).sale.findUnique({
      where: { id: saleId },
      include: saleInclude,
    });
    if (!sale) throw new NotFoundException('Venda não encontrada');
    return sale as SaleLoaded;
  }
}

const saleInclude = {
  items: {
    include: {
      variant: { include: { product: { select: { name: true, taxUnit: true, isService: true } } } },
    },
  },
  payments: true,
  fiscalDocument: true,
  returns: { include: { items: true } },
} as const;

type SaleLoaded = {
  id: string;
  number: number;
  status: SaleStatus;
  source: SaleSource;
  customerId: string | null;
  total: unknown;
  createdAt: Date;
  deductStock: boolean;
  items: Array<{
    id: string;
    variantId: string;
    quantity: unknown;
    unitPrice: unknown;
    totalLine: unknown;
    variant: { sku: string; product: { name: string; taxUnit: string | null; isService: boolean } };
  }>;
  payments: Array<{ method: PaymentMethod; amount: unknown }>;
  fiscalDocument: {
    id: string;
    kind: FiscalDocumentKind;
    status: FiscalDocumentStatus;
    accessKey: string | null;
    updatedAt: Date;
  } | null;
  returns: Array<{ items: Array<{ saleItemId: string; quantity: unknown }> }>;
};

function returnedQtyByItem(returns: SaleLoaded['returns']): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of returns) {
    for (const it of row.items) {
      map.set(it.saleItemId, roundQty((map.get(it.saleItemId) ?? 0) + Number(it.quantity)));
    }
  }
  return map;
}

function describeFiscal(sale: SaleLoaded, now: number, fullReturn: boolean) {
  const doc = sale.fiscalDocument;
  if (!doc || doc.status === FiscalDocumentStatus.CANCELLED) {
    return {
      canCancel: false,
      cancelOriginal: false,
      queueReturnNfe: false,
      message: 'Sem nota fiscal autorizada. A devolução ajusta estoque e financeiro.',
    };
  }
  if (doc.status !== FiscalDocumentStatus.AUTHORIZED || !doc.accessKey) {
    return {
      canCancel: false,
      cancelOriginal: false,
      queueReturnNfe: false,
      message:
        fullReturn
          ? 'A nota ainda não foi autorizada. Na devolução total a fila local é cancelada.'
          : 'A nota ainda não foi autorizada. Devolução parcial não cancela a fila.',
    };
  }
  const windowMs = doc.kind === FiscalDocumentKind.NFC_E ? NFC_E_CANCEL_MS : NF_E_CANCEL_MS;
  const within = now - sale.createdAt.getTime() <= windowMs;
  if (fullReturn && within) {
    return {
      canCancel: true,
      cancelOriginal: true,
      queueReturnNfe: false,
      message:
        doc.kind === FiscalDocumentKind.NFC_E
          ? 'Devolução total dentro de 30 minutos: a NFC-e original será cancelada.'
          : 'Devolução total dentro de 24 horas: a NF-e original será cancelada.',
    };
  }
  return {
    canCancel: false,
    cancelOriginal: false,
    queueReturnNfe: true,
    message: fullReturn
      ? 'Prazo de cancelamento vencido. Será enfileirada uma NF-e de devolução.'
      : 'Devolução parcial. Será enfileirada uma NF-e de devolução só dos itens devolvidos.',
  };
}

async function reduceRequisitionTitles(
  tx: {
    accountReceivable: {
      findMany: (args: object) => Promise<
        Array<{ id: string; amount: unknown; amountRemaining: unknown; status: BillStatus }>
      >;
      update: (args: object) => Promise<unknown>;
    };
  },
  saleId: string,
  target: number,
): Promise<number> {
  let left = roundMoney(target);
  if (!(left > 0)) return 0;
  const rows = await tx.accountReceivable.findMany({
    where: {
      saleId,
      creditKind: CreditKind.REQUISITION,
      status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },
    },
    orderBy: { dueDate: 'desc' },
  });
  let reduced = 0;
  for (const row of rows) {
    if (left <= 0.009) break;
    const remaining = Number(row.amountRemaining);
    if (!(remaining > 0)) continue;
    const cut = Math.min(remaining, left);
    const nextRemaining = roundMoney(remaining - cut);
    const nextAmount = roundMoney(Math.max(0, Number(row.amount) - cut));
    const status =
      nextRemaining <= 0.009
        ? nextAmount <= 0.009
          ? BillStatus.CANCELLED
          : BillStatus.PAID
        : row.status;
    await tx.accountReceivable.update({
      where: { id: row.id },
      data: {
        amount: nextAmount.toFixed(2),
        amountRemaining: nextRemaining.toFixed(2),
        status,
        receivedAt: status === BillStatus.PAID ? new Date() : undefined,
      },
    });
    reduced = roundMoney(reduced + cut);
    left = roundMoney(left - cut);
  }
  return reduced;
}
