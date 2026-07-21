import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  BillStatus,
  GoodsReceiptMode,
  GoodsReceiptStatus,
  InboundNfeStatus,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { validateNfeAccessKey } from '../fiscal/utils/nfe-access-key';
import { resolveStockFromInvoice } from '../common/product-conversion.util';

export type ReceiptItemDto = {
  variantId: string;
  quantity: number;
  unitCost: number;
  ncm?: string | null;
  cfop?: string | null;
  description?: string | null;
  supplierProductCode?: string | null;
  invoiceUnit?: string | null;
  invoiceQuantity?: number | null;
};

export type PayableOptionsDto = {
  enabled: boolean;
  installments?: number;
  intervalDays?: number;
  firstDueDate?: string | null;
};

export type CreateGoodsReceiptInput = {
  mode: GoodsReceiptMode;
  nfeAccessKey?: string | null;
  supplierId?: string | null;
  locationId: string;
  documentNumber?: string | null;
  series?: string | null;
  issueDate?: string | null;
  natureOperation?: string | null;
  totalValue?: number | null;
  notes?: string | null;
  items: ReceiptItemDto[];
  payable?: PayableOptionsDto | null;
  userId?: string | null;
  /** Default POSTED (comportamento legado). DRAFT não move estoque. */
  status?: GoodsReceiptStatus;
};

@Injectable()
export class GoodsReceiptService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(tenantSlug: string, body: CreateGoodsReceiptInput) {
    if (!body.items?.length) {
      throw new BadRequestException('Informe ao menos um item');
    }
    for (const it of body.items) {
      if (!it.variantId?.trim()) {
        throw new BadRequestException('Cada item precisa de um produto/variação (variantId).');
      }
      const rawQty = it.invoiceQuantity != null ? Number(it.invoiceQuantity) : Number(it.quantity);
      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        throw new BadRequestException('Quantidade de cada item deve ser maior que zero.');
      }
      if (!Number.isFinite(Number(it.unitCost)) || Number(it.unitCost) < 0) {
        throw new BadRequestException('Custo unitário inválido em um dos itens.');
      }
    }
    if (!body.locationId?.trim()) {
      throw new BadRequestException('Informe o local de estoque.');
    }

    let nfeAccessKey: string | null = null;
    if (body.mode === GoodsReceiptMode.WITH_NFE_KEY) {
      const validated = validateNfeAccessKey(body.nfeAccessKey ?? '');
      if (!validated.ok) {
        throw new BadRequestException(validated.reason);
      }
      nfeAccessKey = validated.key;
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);

    if (nfeAccessKey) {
      const existing = await db.goodsReceipt.findFirst({
        where: { nfeAccessKey },
        select: { id: true, controlNumber: true, documentNumber: true, createdAt: true },
      });
      if (existing) {
        throw new ConflictException({
          message: `Esta NF-e já foi importada na entrada #${existing.controlNumber}.`,
          duplicate: {
            accessKey: nfeAccessKey,
            goodsReceiptId: existing.id,
            controlNumber: existing.controlNumber,
            documentNumber: existing.documentNumber,
            createdAt: existing.createdAt.toISOString(),
          },
        });
      }
    }

    return db
      .$transaction(async (tx) => {
        const postStock = (body.status ?? GoodsReceiptStatus.POSTED) === GoodsReceiptStatus.POSTED;
        const receipt = await tx.goodsReceipt.create({
          data: {
            mode: body.mode,
            nfeAccessKey,
            supplierId: body.supplierId ?? null,
            documentNumber: body.documentNumber ?? null,
            series: body.series ?? null,
            issueDate: body.issueDate ? new Date(body.issueDate) : null,
            natureOperation: body.natureOperation ?? null,
            totalValue: body.totalValue != null ? String(body.totalValue) : null,
            notes: body.notes ?? null,
            status: postStock ? GoodsReceiptStatus.POSTED : GoodsReceiptStatus.DRAFT,
            postedAt: postStock ? new Date() : null,
            userId: body.userId?.trim() || null,
            items: {
              create: await Promise.all(
                body.items.map(async (it) => {
                  const variant = await tx.productVariant.findUniqueOrThrow({
                    where: { id: it.variantId },
                    include: { product: { select: { conversion: true } } },
                  });
                  const rawQty =
                    it.invoiceQuantity != null ? Number(it.invoiceQuantity) : Number(it.quantity);
                  const rawCost = Number(it.unitCost);
                  const resolved = resolveStockFromInvoice(
                    rawQty,
                    it.invoiceUnit,
                    rawCost,
                    variant.product.conversion,
                  );
                  return {
                    variantId: it.variantId,
                    quantity: String(resolved.quantity),
                    unitCost: String(resolved.unitCost),
                    ncm: it.ncm ?? null,
                    cfop: it.cfop ?? null,
                    description: it.description ?? null,
                    supplierProductCode: it.supplierProductCode?.trim() || null,
                    invoiceUnit: it.invoiceUnit?.trim().toUpperCase() || null,
                  };
                }),
              ),
            },
          },
          include: { items: true },
        });

        if (!postStock) {
          return tx.goodsReceipt.findUniqueOrThrow({
            where: { id: receipt.id },
            include: {
              supplier: true,
              items: { include: { variant: { include: { product: true } } } },
              payables: true,
            },
          });
        }

        for (const it of body.items) {
          const variant = await tx.productVariant.findUniqueOrThrow({
            where: { id: it.variantId },
            include: { product: { select: { conversion: true } } },
          });
          const rawQty =
            it.invoiceQuantity != null ? Number(it.invoiceQuantity) : Number(it.quantity);
          const rawCost = Number(it.unitCost);
          const resolved = resolveStockFromInvoice(
            rawQty,
            it.invoiceUnit,
            rawCost,
            variant.product.conversion,
          );
          const qtyNum = resolved.quantity;
          const unitCost = resolved.unitCost;
          const bal = await tx.stockBalance.findUnique({
            where: {
              variantId_locationId: { variantId: it.variantId, locationId: body.locationId },
            },
          });
          const current = bal ? Number(bal.quantity) : 0;
          const next = current + qtyNum;
          await tx.stockBalance.upsert({
            where: {
              variantId_locationId: { variantId: it.variantId, locationId: body.locationId },
            },
            create: {
              variantId: it.variantId,
              locationId: body.locationId,
              quantity: String(next),
            },
            update: { quantity: String(next) },
          });

          await tx.stockMovement.create({
            data: {
              type: StockMovementType.IN,
              source: StockMovementSource.GOODS_RECEIPT,
              variantId: it.variantId,
              locationId: body.locationId,
              quantity: String(Math.abs(qtyNum)),
              unitCost: String(unitCost),
              reference: `Entrada NF ${body.documentNumber ?? receipt.id.slice(0, 8)}`,
              userId: body.userId,
              goodsReceiptId: receipt.id,
            },
          });

          const variantRow = await tx.productVariant.findUniqueOrThrow({
            where: { id: it.variantId },
          });
          const oldCost = Number(variantRow.costAverage);
          const denom = next;
          const newAverage =
            denom > 0 ? (oldCost * Math.max(current, 0) + unitCost * qtyNum) / denom : unitCost;
          const oldCostDec = new Prisma.Decimal(variantRow.costAverage);
          const newAvgDec = new Prisma.Decimal(String(newAverage));
          if (!oldCostDec.equals(newAvgDec)) {
            await tx.productVariantPriceHistory.create({
              data: {
                variantId: it.variantId,
                field: 'COST',
                previousValue: oldCostDec,
                newValue: newAvgDec,
                source: 'GOODS_RECEIPT',
                goodsReceiptId: receipt.id,
              },
            });
          }
          await tx.productVariant.update({
            where: { id: it.variantId },
            data: { costAverage: String(newAverage) },
          });

          const linkCode = it.supplierProductCode?.trim();
          if (body.supplierId && linkCode) {
            await tx.supplierProductLink.upsert({
              where: {
                supplierId_supplierProductCode: {
                  supplierId: body.supplierId,
                  supplierProductCode: linkCode,
                },
              },
              create: {
                supplierId: body.supplierId,
                variantId: it.variantId,
                supplierProductCode: linkCode,
              },
              update: { variantId: it.variantId },
            });
          }
        }

        if (body.payable?.enabled) {
          const installments = Math.max(1, Math.min(60, Number(body.payable.installments ?? 1) | 0));
          const intervalDays = Math.max(
            1,
            Math.min(180, Number(body.payable.intervalDays ?? 30) | 0),
          );
          const firstDue = body.payable.firstDueDate
            ? new Date(body.payable.firstDueDate)
            : new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);

          const total =
            body.totalValue != null
              ? Number(body.totalValue)
              : body.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitCost), 0);

          const installmentAmount = total / installments;
          const supplierName = body.supplierId
            ? ((await tx.supplier.findUnique({ where: { id: body.supplierId } }))?.legalName ?? '')
            : '';
          const docLabel = body.documentNumber
            ? `NF ${body.documentNumber}`
            : `Entrada #${receipt.controlNumber}`;

          let parentId: string | null = null;
          for (let i = 0; i < installments; i++) {
            const due = new Date(firstDue.getTime());
            due.setDate(due.getDate() + intervalDays * i);
            const description =
              installments > 1
                ? `${docLabel} (${i + 1}/${installments})${supplierName ? ' - ' + supplierName : ''}`
                : `${docLabel}${supplierName ? ' - ' + supplierName : ''}`;
            const instStr = installmentAmount.toFixed(2);
            const created: { id: string } = await tx.accountPayable.create({
              data: {
                supplierId: body.supplierId ?? null,
                description,
                amount: instStr,
                amountRemaining: instStr,
                dueDate: due,
                status: BillStatus.OPEN,
                goodsReceiptId: receipt.id,
                recurrenceIndex: installments > 1 ? i + 1 : null,
                recurrenceCount: installments > 1 ? installments : null,
                parentRecurringId: parentId,
              },
            });
            if (i === 0) parentId = created.id;
          }
        }

        return tx.goodsReceipt.findUniqueOrThrow({
          where: { id: receipt.id },
          include: {
            supplier: true,
            items: { include: { variant: { include: { product: true } } } },
            payables: true,
          },
        });
      })
      .then(async (result) => {
        if (nfeAccessKey) {
          const isPosted = result.status === GoodsReceiptStatus.POSTED;
          await db.inboundNfeDocument.updateMany({
            where: { accessKey: nfeAccessKey, goodsReceiptId: null },
            data: {
              goodsReceiptId: result.id,
              ...(isPosted ? { status: InboundNfeStatus.IMPORTADO } : {}),
            },
          });
        }
        return result;
      });
  }
}
