import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
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

type ReceiptItemDto = {
  variantId: string;
  quantity: number;
  unitCost: number;
  ncm?: string | null;
  cfop?: string | null;
  description?: string | null;
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
        orderBy: { createdAt: 'desc' },
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
    },
  ) {
    if (!body.items?.length) {
      throw new BadRequestException('Informe ao menos um item');
    }
    if (body.mode === GoodsReceiptMode.WITH_NFE_KEY) {
      const k = (body.nfeAccessKey ?? '').replace(/\D/g, '');
      if (k.length !== 44) {
        throw new BadRequestException('Chave de acesso deve conter 44 dígitos');
      }
      body.nfeAccessKey = k;
    } else {
      body.nfeAccessKey = null;
    }

    const db = await this.tenantPrisma.getClient(user.tenantSlug);

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

      return tx.goodsReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
        include: {
          supplier: true,
          items: { include: { variant: { include: { product: true } } } },
        },
      });
    });
  }
}
