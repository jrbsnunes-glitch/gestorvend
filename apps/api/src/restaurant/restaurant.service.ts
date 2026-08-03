import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DiningTableStatus,
  PaymentMethod,
  SaleSource,
  ServiceTabItemStatus,
  ServiceTabStatus,
} from '../generated/tenant-client';
import { PlanCode } from '../generated/central-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { SalesService } from '../sales/sales.service';
import { CompanyService } from '../company/company.service';

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseQty(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class RestaurantService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tenants: TenantService,
    private readonly sales: SalesService,
    private readonly company: CompanyService,
  ) {}

  /** Plano RESTAURANT no central + flag da empresa. */
  async assertRestaurantEnabled(tenantSlug: string): Promise<void> {
    await this.tenants.assertPlan(tenantSlug, [PlanCode.RESTAURANT]);
    const co = await this.company.getOrCreate(tenantSlug);
    if (!co.restaurantModuleEnabled) {
      throw new ForbiddenException(
        'Módulo restaurante desativado na empresa. Ative em Empresa → Restaurante.',
      );
    }
  }

  private async db(tenantSlug: string) {
    await this.assertRestaurantEnabled(tenantSlug);
    return this.tenantPrisma.getClient(tenantSlug);
  }

  // --- Ambientes / mesas ---

  listAreas(tenantSlug: string) {
    return this.db(tenantSlug).then((db) =>
      db.diningArea.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          tables: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
            include: {
              tabs: {
                where: { status: ServiceTabStatus.OPEN },
                select: { id: true, number: true },
              },
            },
          },
        },
      }),
    );
  }

  async createArea(tenantSlug: string, body: { name: string; sortOrder?: number }) {
    const db = await this.db(tenantSlug);
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('Nome do ambiente é obrigatório.');
    return db.diningArea.create({
      data: { name, sortOrder: body.sortOrder ?? 0 },
    });
  }

  async createTable(
    tenantSlug: string,
    body: { areaId: string; code: string; label?: string | null; capacity?: number | null },
  ) {
    const db = await this.db(tenantSlug);
    const code = String(body.code ?? '').trim();
    if (!body.areaId || !code) {
      throw new BadRequestException('Área e código da mesa são obrigatórios.');
    }
    const area = await db.diningArea.findUnique({ where: { id: body.areaId } });
    if (!area) throw new NotFoundException('Ambiente não encontrado.');
    return db.diningTable.create({
      data: {
        areaId: body.areaId,
        code,
        label: body.label?.trim() || null,
        capacity: body.capacity ?? null,
      },
    });
  }

  // --- Comandas ---

  async listOpenTabs(tenantSlug: string) {
    const db = await this.db(tenantSlug);
    return db.serviceTab.findMany({
      where: { status: ServiceTabStatus.OPEN },
      orderBy: { number: 'asc' },
      include: {
        table: { include: { area: true } },
        items: {
          where: { status: { not: ServiceTabItemStatus.CANCELLED } },
          include: {
            variant: { include: { product: { select: { id: true, name: true, taxUnit: true, tareKg: true } } } },
          },
        },
        customer: { select: { id: true, name: true } },
        openedBy: { select: { id: true, name: true } },
      },
    });
  }

  async getTab(tenantSlug: string, id: string) {
    const db = await this.db(tenantSlug);
    const tab = await db.serviceTab.findUnique({
      where: { id },
      include: {
        table: { include: { area: true } },
        items: {
          include: {
            variant: { include: { product: { select: { id: true, name: true, taxUnit: true, tareKg: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
        customer: true,
        openedBy: { select: { id: true, name: true } },
        sale: { select: { id: true, number: true, total: true } },
      },
    });
    if (!tab) throw new NotFoundException('Comanda não encontrada.');
    return tab;
  }

  async openTab(
    tenantSlug: string,
    userId: string,
    body: { tableId?: string | null; customerId?: string | null; notes?: string | null },
  ) {
    const db = await this.db(tenantSlug);
    let tableId = body.tableId?.trim() || null;
    if (tableId) {
      const table = await db.diningTable.findUnique({ where: { id: tableId } });
      if (!table || !table.isActive) throw new BadRequestException('Mesa inválida.');
      await db.diningTable.update({
        where: { id: tableId },
        data: { status: DiningTableStatus.OCCUPIED },
      });
    }
    return db.serviceTab.create({
      data: {
        tableId,
        customerId: body.customerId ?? null,
        notes: body.notes?.trim() || null,
        openedById: userId,
      },
      include: {
        table: { include: { area: true } },
        items: true,
      },
    });
  }

  async addItem(
    tenantSlug: string,
    tabId: string,
    body: {
      variantId: string;
      quantity: number | string;
      unitPrice?: number | string;
      discount?: number | string;
      notes?: string | null;
      weightGross?: number | string | null;
      weightTare?: number | string | null;
      printSector?: string | null;
    },
  ) {
    const db = await this.db(tenantSlug);
    const tab = await db.serviceTab.findUnique({ where: { id: tabId } });
    if (!tab) throw new NotFoundException('Comanda não encontrada.');
    if (tab.status !== ServiceTabStatus.OPEN) {
      throw new BadRequestException('Comanda não está aberta.');
    }

    const variant = await db.productVariant.findUnique({
      where: { id: body.variantId },
      include: { product: true },
    });
    if (!variant || !variant.product.isActive) {
      throw new BadRequestException('Produto inválido ou inativo.');
    }

    let qty = parseQty(body.quantity);
    const tareFromProduct = variant.product.tareKg != null ? Number(variant.product.tareKg) : 0;
    const weightGross = body.weightGross != null ? parseQty(body.weightGross) : null;
    const weightTare =
      body.weightTare != null ? parseQty(body.weightTare) : weightGross != null ? tareFromProduct : null;
    if (weightGross != null) {
      const net = Math.max(0, weightGross - (weightTare ?? 0));
      qty = Math.round(net * 1000) / 1000;
    }
    if (qty <= 0) throw new BadRequestException('Quantidade/peso inválido.');

    const unitPrice =
      body.unitPrice != null
        ? parseQty(body.unitPrice)
        : Number(variant.promoPrice ?? variant.retailPrice);
    const discount = parseQty(body.discount ?? 0);
    const totalLine = money(qty * unitPrice - discount);

    return db.serviceTabItem.create({
      data: {
        tabId,
        variantId: body.variantId,
        quantity: String(qty),
        unitPrice: String(unitPrice),
        discount: String(discount.toFixed(2)),
        totalLine: String(totalLine.toFixed(2)),
        notes: body.notes?.trim() || null,
        weightGross: weightGross != null ? String(weightGross) : null,
        weightTare: weightTare != null ? String(weightTare) : null,
        printSector: body.printSector?.trim()?.toUpperCase() || null,
        status: ServiceTabItemStatus.ORDERED,
      },
      include: {
        variant: { include: { product: { select: { id: true, name: true, taxUnit: true, tareKg: true } } } },
      },
    });
  }

  async cancelItem(tenantSlug: string, tabId: string, itemId: string) {
    const db = await this.db(tenantSlug);
    const item = await db.serviceTabItem.findFirst({ where: { id: itemId, tabId } });
    if (!item) throw new NotFoundException('Item não encontrado.');
    return db.serviceTabItem.update({
      where: { id: itemId },
      data: { status: ServiceTabItemStatus.CANCELLED },
    });
  }

  async cancelTab(tenantSlug: string, tabId: string) {
    const db = await this.db(tenantSlug);
    const tab = await db.serviceTab.findUnique({ where: { id: tabId } });
    if (!tab) throw new NotFoundException('Comanda não encontrada.');
    if (tab.status !== ServiceTabStatus.OPEN) {
      throw new BadRequestException('Só é possível cancelar comanda aberta.');
    }
    const updated = await db.serviceTab.update({
      where: { id: tabId },
      data: { status: ServiceTabStatus.CANCELLED, closedAt: new Date() },
    });
    if (tab.tableId) {
      const otherOpen = await db.serviceTab.count({
        where: {
          tableId: tab.tableId,
          status: ServiceTabStatus.OPEN,
          id: { not: tabId },
        },
      });
      if (otherOpen === 0) {
        await db.diningTable.update({
          where: { id: tab.tableId },
          data: { status: DiningTableStatus.FREE },
        });
      }
    }
    return updated;
  }

  async markKitchenPrinted(tenantSlug: string, tabId: string, itemIds?: string[]) {
    const db = await this.db(tenantSlug);
    const where =
      itemIds?.length
        ? { tabId, id: { in: itemIds }, status: { not: ServiceTabItemStatus.CANCELLED } }
        : {
            tabId,
            status: { not: ServiceTabItemStatus.CANCELLED },
            kitchenPrintedAt: null,
          };
    await db.serviceTabItem.updateMany({
      where,
      data: { kitchenPrintedAt: new Date(), status: ServiceTabItemStatus.PREPARING },
    });
    return this.getTab(tenantSlug, tabId);
  }

  async closeTab(
    tenantSlug: string,
    userId: string,
    userRoles: string[],
    tabId: string,
    body: {
      discount?: number | string;
      surcharge?: number | string;
      notes?: string | null;
      permissionPassword?: string;
      payments: Array<{
        method: PaymentMethod;
        amount: number | string;
        installments?: number;
        paymentFormId?: string | null;
        authCode?: string | null;
      }>;
    },
  ) {
    const db = await this.db(tenantSlug);
    const tab = await db.serviceTab.findUnique({
      where: { id: tabId },
      include: {
        items: { where: { status: { not: ServiceTabItemStatus.CANCELLED } } },
      },
    });
    if (!tab) throw new NotFoundException('Comanda não encontrada.');
    if (tab.status !== ServiceTabStatus.OPEN) {
      throw new BadRequestException('Comanda já fechada ou cancelada.');
    }
    if (!tab.items.length) {
      throw new BadRequestException('Comanda sem itens para fechar.');
    }

    const sale = await this.sales.create({
      tenantSlug,
      userId,
      userRoles,
      permissionPassword: body.permissionPassword,
      customerId: tab.customerId,
      notes: body.notes ?? tab.notes,
      discount: body.discount ?? 0,
      surcharge: body.surcharge ?? 0,
      source: SaleSource.RESTAURANT,
      externalRef: `tab:${tab.number}`,
      items: tab.items.map((it) => ({
        variantId: it.variantId,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        discount: Number(it.discount),
      })),
      payments: body.payments,
    });

    await db.serviceTab.update({
      where: { id: tabId },
      data: {
        status: ServiceTabStatus.CLOSED,
        closedAt: new Date(),
        saleId: sale.id,
      },
    });

    if (tab.tableId) {
      const otherOpen = await db.serviceTab.count({
        where: {
          tableId: tab.tableId,
          status: ServiceTabStatus.OPEN,
          id: { not: tabId },
        },
      });
      if (otherOpen === 0) {
        await db.diningTable.update({
          where: { id: tab.tableId },
          data: { status: DiningTableStatus.FREE },
        });
      }
    }

    return { tab: await this.getTab(tenantSlug, tabId), sale };
  }

  // --- Ficha técnica (BOM) ---

  async getRecipe(tenantSlug: string, productId: string) {
    const db = await this.db(tenantSlug);
    return db.productRecipe.findUnique({
      where: { productId },
      include: {
        items: {
          include: {
            ingredientVariant: {
              include: { product: { select: { id: true, name: true, taxUnit: true } } },
            },
          },
        },
      },
    });
  }

  async upsertRecipe(
    tenantSlug: string,
    productId: string,
    body: {
      notes?: string | null;
      items: Array<{ ingredientVariantId: string; quantity: number | string }>;
    },
  ) {
    const db = await this.db(tenantSlug);
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produto não encontrado.');

    const items = (body.items ?? [])
      .map((it) => ({
        ingredientVariantId: String(it.ingredientVariantId),
        quantity: parseQty(it.quantity),
      }))
      .filter((it) => it.ingredientVariantId && it.quantity > 0);

    return db.$transaction(async (tx) => {
      const existing = await tx.productRecipe.findUnique({ where: { productId } });
      if (existing) {
        await tx.productRecipeItem.deleteMany({ where: { recipeId: existing.id } });
        return tx.productRecipe.update({
          where: { id: existing.id },
          data: {
            notes: body.notes?.trim() || null,
            items: {
              create: items.map((it) => ({
                ingredientVariantId: it.ingredientVariantId,
                quantity: String(it.quantity),
              })),
            },
          },
          include: {
            items: {
              include: {
                ingredientVariant: {
                  include: { product: { select: { id: true, name: true, taxUnit: true } } },
                },
              },
            },
          },
        });
      }
      return tx.productRecipe.create({
        data: {
          productId,
          notes: body.notes?.trim() || null,
          items: {
            create: items.map((it) => ({
              ingredientVariantId: it.ingredientVariantId,
              quantity: String(it.quantity),
            })),
          },
        },
        include: {
          items: {
            include: {
              ingredientVariant: {
                include: { product: { select: { id: true, name: true, taxUnit: true } } },
              },
            },
          },
        },
      });
    });
  }
}
