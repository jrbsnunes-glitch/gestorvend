import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private async applyVariantPriceUpdates(
    tx: Prisma.TransactionClient,
    productId: string,
    updates: Array<{
      variantId: string;
      retailPrice?: number | string;
      costAverage?: number | string;
      minStock?: number | string;
    }>,
  ) {
    for (const vp of updates) {
      const v = await tx.productVariant.findFirst({
        where: { id: vp.variantId, productId },
      });
      if (!v) continue;

      let nextRetail: string | undefined;
      let nextCost: string | undefined;
      let nextMinStock: string | undefined;

      if (vp.retailPrice !== undefined) {
        const newR = new Prisma.Decimal(String(vp.retailPrice));
        if (!new Prisma.Decimal(v.retailPrice).equals(newR)) {
          await tx.productVariantPriceHistory.create({
            data: {
              variantId: v.id,
              field: 'RETAIL',
              previousValue: v.retailPrice,
              newValue: newR,
              source: 'MANUAL',
            },
          });
          nextRetail = newR.toString();
        }
      }
      if (vp.costAverage !== undefined) {
        const newC = new Prisma.Decimal(String(vp.costAverage));
        if (!new Prisma.Decimal(v.costAverage).equals(newC)) {
          await tx.productVariantPriceHistory.create({
            data: {
              variantId: v.id,
              field: 'COST',
              previousValue: v.costAverage,
              newValue: newC,
              source: 'MANUAL',
            },
          });
          nextCost = newC.toString();
        }
      }
      if (vp.minStock !== undefined) {
        const newMin = new Prisma.Decimal(String(vp.minStock));
        if (!new Prisma.Decimal(v.minStock).equals(newMin)) {
          nextMinStock = newMin.toString();
        }
      }

      if (nextRetail !== undefined || nextCost !== undefined || nextMinStock !== undefined) {
        await tx.productVariant.update({
          where: { id: v.id },
          data: {
            ...(nextRetail !== undefined ? { retailPrice: nextRetail } : {}),
            ...(nextCost !== undefined ? { costAverage: nextCost } : {}),
            ...(nextMinStock !== undefined ? { minStock: nextMinStock } : {}),
          },
        });
      }
    }
  }

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.product.findMany({
      include: { variants: true, category: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Consulta em tempo real por nome, descrição, SKU ou código de barras (une estoque por variação). */
  @Get('search')
  @Roles('admin', 'manager', 'seller', 'finance')
  async search(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const term = (q ?? '').trim();
    if (term.length < 1) return [];

    const variants = await db.productVariant.findMany({
      where: {
        OR: [
          { product: { name: { contains: term, mode: 'insensitive' } } },
          { product: { description: { contains: term, mode: 'insensitive' } } },
          { sku: { contains: term, mode: 'insensitive' } },
          { barcode: { contains: term, mode: 'insensitive' } },
        ],
      },
      take: 80,
      orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
      include: {
        product: { select: { id: true, name: true, description: true } },
        stockBalances: { select: { quantity: true } },
      },
    });

    return variants.map((v) => {
      const stockTotal = v.stockBalances.reduce(
        (acc, b) => acc.add(b.quantity),
        new Prisma.Decimal(0),
      );
      return {
        productId: v.product.id,
        productName: v.product.name,
        description: v.product.description,
        variantId: v.id,
        sku: v.sku,
        barcode: v.barcode,
        retailPrice: String(v.retailPrice),
        promoPrice: v.promoPrice ? String(v.promoPrice) : null,
        costAverage: String(v.costAverage),
        stockTotal: stockTotal.toString(),
        minStock: String(v.minStock),
      };
    });
  }

  @Get(':id/price-history')
  @Roles('admin', 'manager', 'seller', 'finance')
  async priceHistory(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const variants = await db.productVariant.findMany({
      where: { productId: id },
      select: { id: true, sku: true },
    });
    if (!variants.length) return [];
    const rows = await db.productVariantPriceHistory.findMany({
      where: { variantId: { in: variants.map((x) => x.id) } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const skuById = new Map(variants.map((v) => [v.id, v.sku]));
    return rows.map((r) => ({
      id: r.id,
      variantId: r.variantId,
      sku: skuById.get(r.variantId) ?? '',
      field: r.field,
      previousValue: String(r.previousValue),
      newValue: String(r.newValue),
      source: r.source,
      goodsReceiptId: r.goodsReceiptId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.product.findUniqueOrThrow({
      where: { id },
      include: { variants: true, category: true },
    });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      name: string;
      description?: string | null;
      defaultBarcode?: string | null;
      categoryId?: string | null;
      ncm?: string | null;
      cest?: string | null;
      exTipi?: string | null;
      fiscalOrigin?: string | null;
      taxUnit?: string | null;
      variants: Array<{
        sku: string;
        barcode?: string | null;
        retailPrice: number | string;
        wholesalePrice?: number | string | null;
        costAverage?: number | string;
        minStock?: number | string;
      }>;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    // O código de barras "principal" do produto também é replicado para a
    // primeira variante quando ela não tem código próprio — mantém a busca
    // por EAN funcional no PDV.
    const defaultBarcode = body.defaultBarcode?.trim() ? body.defaultBarcode.trim().slice(0, 32) : null;
    return db.product.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        defaultBarcode,
        categoryId: body.categoryId ?? null,
        ncm: body.ncm ?? null,
        cest: body.cest ?? null,
        exTipi: body.exTipi?.trim() ? body.exTipi.trim().slice(0, 10) : null,
        fiscalOrigin: body.fiscalOrigin?.trim() ? body.fiscalOrigin.trim().slice(0, 2) : null,
        taxUnit: body.taxUnit?.trim() ? body.taxUnit.trim().slice(0, 10).toUpperCase() : null,
        variants: {
          create: body.variants.map((v, idx) => ({
            sku: v.sku,
            barcode: v.barcode ?? (idx === 0 ? defaultBarcode : null),
            retailPrice: String(v.retailPrice),
            wholesalePrice: v.wholesalePrice != null ? String(v.wholesalePrice) : null,
            costAverage: v.costAverage != null ? String(v.costAverage) : '0',
            minStock: v.minStock != null ? String(v.minStock) : '0',
          })),
        },
      },
      include: { variants: true },
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: Record<string, unknown> & {
      variantPrices?: Array<{
        variantId: string;
        retailPrice?: number | string;
        costAverage?: number | string;
        minStock?: number | string;
      }>;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const variantPrices = Array.isArray(body.variantPrices) ? body.variantPrices : [];

    return db.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(body.name != null && { name: String(body.name) }),
          ...(body.description !== undefined && {
            description: body.description ? String(body.description) : null,
          }),
          ...(body.defaultBarcode !== undefined && {
            defaultBarcode: body.defaultBarcode
              ? String(body.defaultBarcode).trim().slice(0, 32) || null
              : null,
          }),
          ...(body.ncm !== undefined && { ncm: body.ncm ? String(body.ncm) : null }),
          ...(body.cest !== undefined && { cest: body.cest ? String(body.cest) : null }),
          ...(body.exTipi !== undefined && {
            exTipi: body.exTipi ? String(body.exTipi).trim().slice(0, 10) : null,
          }),
          ...(body.fiscalOrigin !== undefined && {
            fiscalOrigin: body.fiscalOrigin ? String(body.fiscalOrigin).trim().slice(0, 2) : null,
          }),
          ...(body.taxUnit !== undefined && {
            taxUnit: body.taxUnit ? String(body.taxUnit).trim().slice(0, 10).toUpperCase() : null,
          }),
          ...(body.isActive != null && { isActive: Boolean(body.isActive) }),
          ...(body.categoryId !== undefined && {
            categoryId: body.categoryId ? String(body.categoryId) : null,
          }),
        },
      });

      if (variantPrices.length) {
        await this.applyVariantPriceUpdates(tx, id, variantPrices);
      }

      return tx.product.findUniqueOrThrow({
        where: { id },
        include: { variants: true, category: true },
      });
    });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    try {
      await db.product.delete({ where: { id } });
    } catch {
      throw new BadRequestException(
        'Não foi possível excluir (verifique vendas ou movimentos vinculados às variações)',
      );
    }
    return { ok: true };
  }
}
