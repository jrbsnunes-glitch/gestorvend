import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  BillStatus,
  GoodsReceiptMode,
  GoodsReceiptStatus,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { validateNfeAccessKey } from '../fiscal/utils/nfe-access-key';

type ReceiptItemDto = {
  variantId: string;
  quantity: number;
  unitCost: number;
  ncm?: string | null;
  cfop?: string | null;
  description?: string | null;
};

/**
 * Quando marcado, geramos N parcelas em A pagar vinculadas à entrada.
 * - `installments` (1..N) - número de parcelas iguais
 * - `intervalDays` (default 30) - dias entre parcelas
 * - `firstDueDate` opcional - se omitido, usamos `hoje + intervalDays`
 */
type PayableOptionsDto = {
  enabled: boolean;
  installments?: number;
  intervalDays?: number;
  firstDueDate?: string | null;
};

type PrismaKnown = { code: string };

function mapTenantDbError(e: unknown): never {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as PrismaKnown).code;
    if (code === 'P2021') {
      throw new ServiceUnavailableException(
        'Estrutura do banco do tenant desatualizada (tabela de entradas ausente). Rode: npm run prisma:migrate:tenant no pacote da API e garanta que o banco do tenant está apontado em TENANT_DATABASE_URL.',
      );
    }
    if (code === 'P1001' || code === 'P1017') {
      throw new ServiceUnavailableException(
        'Não foi possível conectar ao PostgreSQL do tenant. Verifique TENANT_DATABASE_URL e se o servidor de banco está em execução.',
      );
    }
  }
  throw e;
}

@Controller('goods-receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GoodsReceiptController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload) {
    try {
      const db = await this.tenantPrisma.getClient(user.tenantSlug);
      return await db.goodsReceipt.findMany({
        // Ordenação cronológica: entradas mais antigas no topo.
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: {
          supplier: true,
          items: { include: { variant: { include: { product: true } } } },
        },
      });
    } catch (e) {
      mapTenantDbError(e);
    }
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    try {
      const db = await this.tenantPrisma.getClient(user.tenantSlug);
      return await db.goodsReceipt.findUniqueOrThrow({
        where: { id },
        include: {
          supplier: true,
          items: { include: { variant: { include: { product: true } } } },
        },
      });
    } catch (e) {
      mapTenantDbError(e);
    }
  }

  /// Espelho de lançamento de NF-e / entrada de mercadorias (com ou sem chave).
  @Post()
  @Roles('admin', 'manager')
  async post(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
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
      /** Quando enviado com `enabled: true`, gera contas a pagar vinculadas. */
      payable?: PayableOptionsDto | null;
    },
  ) {
    if (!body.items?.length) {
      throw new BadRequestException('Informe ao menos um item');
    }
    if (body.mode === GoodsReceiptMode.WITH_NFE_KEY) {
      const validated = validateNfeAccessKey(body.nfeAccessKey ?? '');
      if (!validated.ok) {
        throw new BadRequestException(validated.reason);
      }
      body.nfeAccessKey = validated.key;
    } else {
      body.nfeAccessKey = null;
    }

    const db = await this.tenantPrisma.getClient(user.tenantSlug);

    if (body.nfeAccessKey) {
      const existing = await db.goodsReceipt.findFirst({
        where: { nfeAccessKey: body.nfeAccessKey },
        select: { id: true, controlNumber: true, documentNumber: true, createdAt: true },
      });
      if (existing) {
        throw new ConflictException({
          message: `Esta NF-e já foi importada na entrada #${existing.controlNumber}.`,
          duplicate: {
            accessKey: body.nfeAccessKey,
            goodsReceiptId: existing.id,
            controlNumber: existing.controlNumber,
            documentNumber: existing.documentNumber,
            createdAt: existing.createdAt.toISOString(),
          },
        });
      }
    }

    return db.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.create({
        data: {
          mode: body.mode,
          nfeAccessKey: body.nfeAccessKey,
          supplierId: body.supplierId ?? null,
          documentNumber: body.documentNumber ?? null,
          series: body.series ?? null,
          issueDate: body.issueDate ? new Date(body.issueDate) : null,
          natureOperation: body.natureOperation ?? null,
          totalValue: body.totalValue != null ? String(body.totalValue) : null,
          notes: body.notes ?? null,
          status: GoodsReceiptStatus.POSTED,
          postedAt: new Date(),
          userId: user.sub,
          items: {
            create: body.items.map((it) => ({
              variantId: it.variantId,
              quantity: String(it.quantity),
              unitCost: String(it.unitCost),
              ncm: it.ncm ?? null,
              cfop: it.cfop ?? null,
              description: it.description ?? null,
            })),
          },
        },
        include: { items: true },
      });

      for (const it of body.items) {
        const qtyNum = Number(it.quantity);
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
            unitCost: String(it.unitCost),
            reference: `Entrada NF ${body.documentNumber ?? receipt.id.slice(0, 8)}`,
            userId: user.sub,
            goodsReceiptId: receipt.id,
          },
        });

        const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: it.variantId } });
        const oldCost = Number(variant.costAverage);
        const unitCost = Number(it.unitCost);
        const denom = next;
        const newAverage =
          denom > 0 ? (oldCost * Math.max(current, 0) + unitCost * qtyNum) / denom : unitCost;
        const oldCostDec = new Prisma.Decimal(variant.costAverage);
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
      }

      // Geração opcional de contas a pagar a partir da entrada.
      if (body.payable?.enabled) {
        const installments = Math.max(1, Math.min(60, Number(body.payable.installments ?? 1) | 0));
        const intervalDays = Math.max(1, Math.min(180, Number(body.payable.intervalDays ?? 30) | 0));
        const firstDue = body.payable.firstDueDate
          ? new Date(body.payable.firstDueDate)
          : new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);

        // Soma valores dos itens (preço unitário * quantidade) como fallback se totalValue não vier.
        const total = body.totalValue != null
          ? Number(body.totalValue)
          : body.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitCost), 0);

        const installmentAmount = total / installments;
        const supplierName = body.supplierId
          ? (await tx.supplier.findUnique({ where: { id: body.supplierId } }))?.legalName ?? ''
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
    }).then(async (result) => {
      if (body.nfeAccessKey) {
        await db.inboundNfeDocument.updateMany({
          where: { accessKey: body.nfeAccessKey, goodsReceiptId: null },
          data: { goodsReceiptId: result.id },
        });
      }
      return result;
    });
  }

  /**
   * Edição parcial — apenas campos de cabeçalho (notas, fornecedor, documento,
   * série, data de emissão, natureza). Os itens já lançados não são editáveis
   * para preservar custo médio e estoque.
   */
  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      supplierId?: string | null;
      documentNumber?: string | null;
      series?: string | null;
      issueDate?: string | null;
      natureOperation?: string | null;
      notes?: string | null;
    },
  ) {
    try {
      const db = await this.tenantPrisma.getClient(user.tenantSlug);
      return await db.goodsReceipt.update({
        where: { id },
        data: {
          supplierId: body.supplierId ?? null,
          documentNumber: body.documentNumber ?? null,
          series: body.series ?? null,
          issueDate: body.issueDate ? new Date(body.issueDate) : null,
          natureOperation: body.natureOperation ?? null,
          notes: body.notes ?? null,
        },
        include: {
          supplier: true,
          items: { include: { variant: { include: { product: true } } } },
        },
      });
    } catch (e) {
      mapTenantDbError(e);
    }
  }
}
