import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import { validateProductConversion, parseProductConversion, normalizeProductConversion } from '../common/product-conversion.util';

const productDetailInclude = {
  variants: { orderBy: { sku: 'asc' as const } },
  category: true,
  fiscalSituation: true,
  stockComponentVariant: {
    select: {
      id: true,
      sku: true,
      barcode: true,
      product: { select: { id: true, name: true, controlNumber: true } },
    },
  },
} as const;

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Valida vínculo caixa → SKU unitário. Exige conversão (como na NF) e impede
   * apontar para o próprio produto ou para outro pack.
   */
  private async resolveStockComponentVariantId(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    opts: {
      productId?: string | null;
      stockComponentVariantId: string | null | undefined;
      conversion: string | null | undefined;
    },
  ): Promise<string | null> {
    const id = opts.stockComponentVariantId?.trim() || null;
    if (!id) return null;
    if (!parseProductConversion(opts.conversion)) {
      throw new BadRequestException(
        'Informe a conversão como na NF-e (ex.: CX-12, CX24, CX-6, PCT-12) ao vincular o produto unitário.',
      );
    }
    const component = await db.productVariant.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true, stockComponentVariantId: true } },
      },
    });
    if (!component) {
      throw new BadRequestException('Produto unitário de estoque não encontrado.');
    }
    if (opts.productId && component.productId === opts.productId) {
      throw new BadRequestException(
        'O estoque unitário deve ser outro produto (ex.: a lata), não a própria caixa.',
      );
    }
    if (component.product.stockComponentVariantId) {
      throw new BadRequestException(
        `O produto "${component.product.name}" também é composto. Vincule o SKU unitário (lata).`,
      );
    }
    return id;
  }

  /** Piso cadastral: variante sempre com reposição configurada como ≥ 1. */
  private parseCadastroVariantMinStock(raw: unknown): string {
    const n = Number(String(raw ?? '1').replace(',', '.'));
    if (!Number.isFinite(n)) {
      throw new BadRequestException('Estoque mínimo da variação deve ser um número válido.');
    }
    if (n < 1) {
      throw new BadRequestException('O estoque mínimo cadastrado da variação deve ser no mínimo 1.');
    }
    return String(n);
  }

  /** Código da unidade tributável; padrão UN quando não informado. */
  private normalizeProductTaxUnit(raw: unknown): string {
    const trimmed = String(raw ?? '')
      .trim()
      .slice(0, 10)
      .toUpperCase();
    return trimmed || 'UN';
  }

  private async syncProductInventoryControlMin(tx: Prisma.TransactionClient, productId: string) {
    const agg = await tx.productVariant.aggregate({
      where: { productId },
      _min: { minStock: true },
    });
    const minVal = agg._min.minStock ?? new Prisma.Decimal(1);
    await tx.product.update({
      where: { id: productId },
      data: { inventoryControlMin: minVal },
    });
  }

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
        const newMinStr = this.parseCadastroVariantMinStock(vp.minStock);
        const newMin = new Prisma.Decimal(newMinStr);
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

  private parseProductControlSearch(term: string): number | null {
    if (!/^\d+$/.test(term)) return null;
    const n = Number.parseInt(term, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private mapProductSearchRows(
    variants: Array<{
      id: string;
      sku: string;
      barcode: string | null;
      retailPrice: Prisma.Decimal;
      promoPrice: Prisma.Decimal | null;
      costAverage: Prisma.Decimal;
      minStock: Prisma.Decimal;
      product: {
        id: string;
        name: string;
        description: string | null;
        inventoryControlMin: Prisma.Decimal;
        controlNumber: number;
      };
      stockBalances: Array<{ quantity: Prisma.Decimal }>;
    }>,
  ) {
    return variants.map((v) => {
      const stockTotal = v.stockBalances.reduce(
        (acc, b) => acc.add(b.quantity),
        new Prisma.Decimal(0),
      );
      return {
        productId: v.product.id,
        productName: v.product.name,
        description: v.product.description,
        productControlNumber: v.product.controlNumber,
        productInventoryControlMin: String(v.product.inventoryControlMin),
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

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.product.findMany({
      include: productDetailInclude,
      orderBy: [{ controlNumber: 'asc' }],
    });
  }

  /** Consulta em tempo real por código sequencial, nome, descrição, SKU ou código de barras. */
  @Get('search')
  @Roles('admin', 'manager', 'seller', 'finance')
  async search(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const term = (q ?? '').trim();
    if (term.length < 1) return [];

    const controlNumber = this.parseProductControlSearch(term);
    const include = {
      product: {
        select: {
          id: true,
          name: true,
          description: true,
          inventoryControlMin: true,
          controlNumber: true,
        },
      },
      stockBalances: { select: { quantity: true } },
    } as const;

    if (controlNumber != null) {
      const exactByCode = await db.productVariant.findMany({
        where: { product: { controlNumber } },
        take: 80,
        orderBy: [{ sku: 'asc' }],
        include,
      });
      if (exactByCode.length) {
        return this.mapProductSearchRows(exactByCode);
      }
    }

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
      orderBy: [{ product: { controlNumber: 'asc' } }, { sku: 'asc' }],
      include,
    });

    return this.mapProductSearchRows(variants);
  }

  /**
   * Manutenção: variantes com mínimo &lt; 1 passam a **1** e o controle produto é recalculado. Não altera `StockMovement`.
   */
  @Post('maintenance/lift-zero-min-stock-to-one')
  @Roles('admin')
  async liftZeroMinStockToOne(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const variantsBelowOne = await db.productVariant.findMany({
      where: { minStock: { lt: new Prisma.Decimal(1) } },
      select: { productId: true },
    });
    const result = await db.productVariant.updateMany({
      where: { minStock: { lt: new Prisma.Decimal(1) } },
      data: { minStock: new Prisma.Decimal(1) },
    });
    await db.$executeRaw`
      UPDATE "Product" AS p
      SET "inventoryControlMin" = v.min_agg
      FROM (
        SELECT "productId", MIN("minStock") AS min_agg
        FROM "ProductVariant"
        GROUP BY "productId"
      ) AS v
      WHERE p.id = v."productId"
    `;
    const distinctProductsAffected = new Set(variantsBelowOne.map((v) => v.productId)).size;
    return {
      ok: true,
      variantsUpdatedCount: result.count,
      distinctProductsAffectedCount: distinctProductsAffected,
      note:
        'Movimentações de estoque (entradas, saídas, ajustes) não foram regravadas — apenas cadastro de mínimos/controle produto.',
    };
  }

  @Get(':id/supplier-links')
  @Roles('admin', 'manager', 'seller', 'finance')
  async listSupplierLinks(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    await db.product.findUniqueOrThrow({ where: { id }, select: { id: true } });
    const variants = await db.productVariant.findMany({
      where: { productId: id },
      select: { id: true, sku: true },
    });
    if (!variants.length) return [];
    return db.supplierProductLink.findMany({
      where: { variantId: { in: variants.map((v) => v.id) } },
      include: {
        supplier: { select: { id: true, legalName: true } },
        variant: { select: { id: true, sku: true } },
      },
      orderBy: [{ supplier: { legalName: 'asc' } }, { supplierProductCode: 'asc' }],
    });
  }

  @Put(':id/supplier-links')
  @Roles('admin', 'manager')
  async syncSupplierLinks(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      links: Array<{
        supplierId: string;
        variantId: string;
        supplierProductCode: string;
      }>;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    await db.product.findUniqueOrThrow({ where: { id }, select: { id: true } });
    const variants = await db.productVariant.findMany({
      where: { productId: id },
      select: { id: true },
    });
    const variantIds = new Set(variants.map((v) => v.id));
    const normalized: Array<{
      supplierId: string;
      variantId: string;
      supplierProductCode: string;
    }> = [];
    const seen = new Set<string>();

    for (const row of body.links ?? []) {
      const supplierId = row.supplierId?.trim();
      const variantId = row.variantId?.trim();
      const code = row.supplierProductCode?.trim().slice(0, 60);
      if (!supplierId || !variantId || !code) continue;
      if (!variantIds.has(variantId)) {
        throw new BadRequestException('Variação não pertence a este produto.');
      }
      const key = `${supplierId}:${code}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          `Código duplicado para o mesmo fornecedor: ${code}`,
        );
      }
      seen.add(key);
      normalized.push({ supplierId, variantId, supplierProductCode: code });
    }

    return db.$transaction(async (tx) => {
      await tx.supplierProductLink.deleteMany({
        where: { variantId: { in: [...variantIds] } },
      });
      for (const link of normalized) {
        await tx.supplierProductLink.create({ data: link });
      }
      return tx.supplierProductLink.findMany({
        where: { variantId: { in: [...variantIds] } },
        include: {
          supplier: { select: { id: true, legalName: true } },
          variant: { select: { id: true, sku: true } },
        },
        orderBy: [{ supplier: { legalName: 'asc' } }, { supplierProductCode: 'asc' }],
      });
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
      include: productDetailInclude,
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
      fiscalSituationId?: string | null;
      ncm?: string | null;
      cest?: string | null;
      exTipi?: string | null;
      fiscalOrigin?: string | null;
      taxUnit?: string | null;
      conversion?: string | null;
      /** SKU unitário (lata) quando este produto é caixa/pack composto. */
      stockComponentVariantId?: string | null;
      variants: Array<{
        sku: string;
        barcode?: string | null;
        retailPrice: number | string;
        wholesalePrice?: number | string | null;
        costAverage?: number | string;
        minStock?: number | string;
      }>;
      /** Vínculos cProd → SKU (aplicados à 1ª variante criada). */
      supplierLinks?: Array<{
        supplierId: string;
        supplierProductCode: string;
      }>;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const conversionErr = validateProductConversion(body.conversion);
    if (conversionErr) throw new BadRequestException(conversionErr);

    const stockComponentVariantId = await this.resolveStockComponentVariantId(db, {
      stockComponentVariantId: body.stockComponentVariantId,
      conversion: body.conversion,
    });

    // O código de barras "principal" do produto também é replicado para a
    // primeira variante quando ela não tem código próprio — mantém a busca
    // por EAN funcional no PDV.
    const defaultBarcode = body.defaultBarcode?.trim() ? body.defaultBarcode.trim().slice(0, 32) : null;

    let fiscalSituationId: string | null = null;
    if (body.fiscalSituationId && String(body.fiscalSituationId).trim()) {
      const fs = await db.fiscalSituation.findFirst({
        where: { id: String(body.fiscalSituationId).trim(), isActive: true },
      });
      if (!fs)
        throw new BadRequestException('Situação fiscal não encontrada ou inativa.');
      fiscalSituationId = fs.id;
    }

    const createdId = await db.$transaction(async (tx) => {
      const prod = await tx.product.create({
        data: {
          name: body.name,
          description: body.description ?? null,
          defaultBarcode,
          categoryId: body.categoryId ?? null,
          fiscalSituationId,
          ncm: body.ncm ?? null,
          cest: body.cest ?? null,
          exTipi: body.exTipi?.trim() ? body.exTipi.trim().slice(0, 10) : null,
          fiscalOrigin: body.fiscalOrigin?.trim() ? body.fiscalOrigin.trim().slice(0, 2) : null,
          taxUnit: this.normalizeProductTaxUnit(body.taxUnit),
          conversion: normalizeProductConversion(body.conversion),
          stockComponentVariantId,
          variants: {
            create: body.variants.map((v, idx) => ({
              sku: v.sku,
              barcode: v.barcode ?? (idx === 0 ? defaultBarcode : null),
              retailPrice: String(v.retailPrice),
              wholesalePrice: v.wholesalePrice != null ? String(v.wholesalePrice) : null,
              costAverage: v.costAverage != null ? String(v.costAverage) : '0',
              minStock: this.parseCadastroVariantMinStock(v.minStock ?? 1),
            })),
          },
        },
        include: { variants: true },
      });
      await this.syncProductInventoryControlMin(tx, prod.id);

      const variantId = prod.variants[0]?.id;
      if (variantId && body.supplierLinks?.length) {
        const seen = new Set<string>();
        for (const link of body.supplierLinks) {
          const supplierId = link.supplierId?.trim();
          const code = link.supplierProductCode?.trim().slice(0, 60);
          if (!supplierId || !code) continue;
          const key = `${supplierId}:${code}`;
          if (seen.has(key)) continue;
          seen.add(key);
          await tx.supplierProductLink.create({
            data: { supplierId, variantId, supplierProductCode: code },
          });
        }
      }

      return prod.id;
    });

    return db.product.findUniqueOrThrow({
      where: { id: createdId },
      include: productDetailInclude,
    });
  }

  /** Cria produto a partir de linha de NF-e de entrada (sem vínculo com fornecedor). */
  @Post('from-inbound-line')
  @Roles('admin', 'manager')
  async createFromInboundLine(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      name: string;
      description?: string | null;
      ncm?: string | null;
      defaultBarcode?: string | null;
      taxUnit?: string | null;
      unitCost?: number | string;
      supplierId?: string | null;
      supplierProductCode?: string | null;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('Informe o nome do produto.');

    const defaultBarcode = body.defaultBarcode?.trim()
      ? body.defaultBarcode.trim().slice(0, 32)
      : null;
    const cost = body.unitCost != null ? String(body.unitCost) : '0';
    const sku = `SKU-${Date.now()}`;

    const created = await db.$transaction(async (tx) => {
      const prod = await tx.product.create({
        data: {
          name,
          description: body.description?.trim() || null,
          defaultBarcode,
          ncm: body.ncm?.trim() || null,
          taxUnit: this.normalizeProductTaxUnit(body.taxUnit),
          variants: {
            create: {
              sku,
              barcode: defaultBarcode,
              retailPrice: cost,
              costAverage: cost,
              minStock: '1',
            },
          },
        },
        include: { variants: true },
      });

      const variantId = prod.variants[0]?.id;
      const linkCode = body.supplierProductCode?.trim();
      if (variantId && body.supplierId && linkCode) {
        await tx.supplierProductLink.upsert({
          where: {
            supplierId_supplierProductCode: {
              supplierId: body.supplierId,
              supplierProductCode: linkCode,
            },
          },
          create: {
            supplierId: body.supplierId,
            variantId,
            supplierProductCode: linkCode,
          },
          update: { variantId },
        });
      }

      await this.syncProductInventoryControlMin(tx, prod.id);
      return prod;
    });

    return created;
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

    if (body.conversion !== undefined) {
      const conversionErr = validateProductConversion(
        body.conversion ? String(body.conversion) : null,
      );
      if (conversionErr) throw new BadRequestException(conversionErr);
    }

    const current = await db.product.findUniqueOrThrow({
      where: { id },
      select: { conversion: true, stockComponentVariantId: true },
    });
    const nextConversion =
      body.conversion !== undefined
        ? body.conversion
          ? normalizeProductConversion(String(body.conversion))
          : null
        : current.conversion;
    let nextStockComponent: string | null | undefined = undefined;
    if (body.conversion !== undefined && !nextConversion) {
      // Sem conversão não há pack composto.
      nextStockComponent =
        body.stockComponentVariantId !== undefined
          ? await this.resolveStockComponentVariantId(db, {
              productId: id,
              stockComponentVariantId: body.stockComponentVariantId
                ? String(body.stockComponentVariantId)
                : null,
              conversion: nextConversion,
            })
          : null;
    } else if (body.stockComponentVariantId !== undefined) {
      nextStockComponent = await this.resolveStockComponentVariantId(db, {
        productId: id,
        stockComponentVariantId: body.stockComponentVariantId
          ? String(body.stockComponentVariantId)
          : null,
        conversion: nextConversion,
      });
    } else if (body.conversion !== undefined && current.stockComponentVariantId) {
      // Recalcula validação se a conversão mudou mantendo vínculo.
      nextStockComponent = await this.resolveStockComponentVariantId(db, {
        productId: id,
        stockComponentVariantId: current.stockComponentVariantId,
        conversion: nextConversion,
      });
    }

    if (body.fiscalSituationId !== undefined && body.fiscalSituationId) {
      const fs = await db.fiscalSituation.findFirst({
        where: { id: String(body.fiscalSituationId), isActive: true },
      });
      if (!fs) throw new BadRequestException('Situação fiscal não encontrada ou inativa.');
    }

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
          ...(body.fiscalSituationId !== undefined && {
            fiscalSituationId: body.fiscalSituationId ? String(body.fiscalSituationId) : null,
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
            taxUnit: this.normalizeProductTaxUnit(body.taxUnit),
          }),
          ...(body.conversion !== undefined && {
            conversion: nextConversion,
          }),
          ...(nextStockComponent !== undefined && {
            stockComponentVariantId: nextStockComponent,
          }),
          ...(body.isActive != null && { isActive: Boolean(body.isActive) }),
          ...(body.categoryId !== undefined && {
            categoryId: body.categoryId ? String(body.categoryId) : null,
          }),
        },
      });

      if (variantPrices.length) {
        await this.applyVariantPriceUpdates(tx, id, variantPrices);
        await this.syncProductInventoryControlMin(tx, id);
      }

      return tx.product.findUniqueOrThrow({
        where: { id },
        include: productDetailInclude,
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
