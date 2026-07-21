import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StockInventoryStatus,
  StockMovementSource,
  StockMovementType,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

const inventoryInclude = {
  location: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, name: true } },
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          barcode: true,
          product: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.StockInventoryInclude;

@Injectable()
export class StockInventoryService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async list(tenantSlug: string, status?: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.StockInventoryWhereInput = {};
    if (
      status === 'DRAFT' ||
      status === 'POSTED' ||
      status === 'CANCELLED'
    ) {
      where.status = status;
    }
    return db.stockInventory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        location: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
  }

  async get(tenantSlug: string, id: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.stockInventory.findUnique({
      where: { id },
      include: inventoryInclude,
    });
    if (!row) throw new NotFoundException('Inventário não encontrado.');
    return row;
  }

  async create(
    tenantSlug: string,
    userId: string,
    body: { locationId?: string; notes?: string | null },
  ) {
    const locationId = String(body.locationId ?? '').trim();
    if (!locationId) throw new BadRequestException('Selecione o local de estoque.');
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const loc = await db.stockLocation.findUnique({ where: { id: locationId } });
    if (!loc) throw new BadRequestException('Local de estoque inválido.');

    return db.stockInventory.create({
      data: {
        locationId,
        notes: body.notes?.trim() || null,
        userId,
        status: StockInventoryStatus.DRAFT,
      },
      include: inventoryInclude,
    });
  }

  async updateHeader(
    tenantSlug: string,
    id: string,
    body: { notes?: string | null },
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível alterar inventário em rascunho.');
    }
    return db.stockInventory.update({
      where: { id },
      data: {
        notes: body.notes !== undefined ? body.notes?.trim() || null : undefined,
      },
      include: inventoryInclude,
    });
  }

  async addItem(
    tenantSlug: string,
    inventoryId: string,
    body: { variantId?: string; countedQty?: string | number | null; notes?: string | null },
  ) {
    const variantId = String(body.variantId ?? '').trim();
    if (!variantId) throw new BadRequestException('Selecione o produto/variação.');

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível incluir itens em rascunho.');
    }

    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      include: {
        product: {
          select: {
            name: true,
            stockComponentVariantId: true,
            conversion: true,
          },
        },
      },
    });
    if (!variant) throw new BadRequestException('Variação inválida.');
    if (variant.product.stockComponentVariantId) {
      throw new BadRequestException(
        `"${variant.product.name}" é produto composto. Inventarie o produto unitário vinculado (estoque real), não a caixa/pack.`,
      );
    }

    const bal = await db.stockBalance.findUnique({
      where: {
        variantId_locationId: { variantId, locationId: inv.locationId },
      },
    });
    const systemQty = bal ? Number(bal.quantity) : 0;

    let countedQty: Prisma.Decimal | null = null;
    if (body.countedQty != null && String(body.countedQty).trim() !== '') {
      const n = Number(String(body.countedQty).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        throw new BadRequestException('Quantidade contada inválida.');
      }
      countedQty = new Prisma.Decimal(String(n));
    }

    try {
      await db.stockInventoryItem.create({
        data: {
          inventoryId,
          variantId,
          systemQty: String(systemQty),
          countedQty,
          notes: body.notes?.trim() || null,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('Este produto já está neste inventário.');
      }
      throw e;
    }

    return this.get(tenantSlug, inventoryId);
  }

  async updateItem(
    tenantSlug: string,
    inventoryId: string,
    itemId: string,
    body: { countedQty?: string | number | null; notes?: string | null },
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível editar itens em rascunho.');
    }

    const item = await db.stockInventoryItem.findFirst({
      where: { id: itemId, inventoryId },
    });
    if (!item) throw new NotFoundException('Item não encontrado.');

    const data: Prisma.StockInventoryItemUpdateInput = {};
    if (body.countedQty !== undefined) {
      if (body.countedQty == null || String(body.countedQty).trim() === '') {
        data.countedQty = null;
      } else {
        const n = Number(String(body.countedQty).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) {
          throw new BadRequestException('Quantidade contada inválida.');
        }
        data.countedQty = new Prisma.Decimal(String(n));
      }
    }
    if (body.notes !== undefined) {
      data.notes = body.notes?.trim() || null;
    }

    await db.stockInventoryItem.update({ where: { id: itemId }, data });
    return this.get(tenantSlug, inventoryId);
  }

  async removeItem(tenantSlug: string, inventoryId: string, itemId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível remover itens em rascunho.');
    }
    const item = await db.stockInventoryItem.findFirst({
      where: { id: itemId, inventoryId },
    });
    if (!item) throw new NotFoundException('Item não encontrado.');
    await db.stockInventoryItem.delete({ where: { id: itemId } });
    return this.get(tenantSlug, inventoryId);
  }

  /** Aplica acertos ADJUST para todos os itens com contagem e fecha o inventário. */
  async post(tenantSlug: string, inventoryId: string, userId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({
      where: { id: inventoryId },
      include: { items: true, location: true },
    });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Inventário já foi postado ou cancelado.');
    }
    if (inv.items.length === 0) {
      throw new BadRequestException('Inclua ao menos 1 produto no inventário.');
    }
    const missing = inv.items.filter((it) => it.countedQty == null);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Informe a quantidade contada em todos os itens (${missing.length} pendente(s)).`,
      );
    }

    const compositeItems = await db.productVariant.findMany({
      where: {
        id: { in: inv.items.map((it) => it.variantId) },
        product: { stockComponentVariantId: { not: null } },
      },
      include: { product: { select: { name: true } } },
    });
    if (compositeItems.length > 0) {
      const names = compositeItems.map((v) => v.product.name).join(', ');
      throw new BadRequestException(
        `Remova produtos compostos do inventário antes de postar: ${names}. Inventarie o produto unitário vinculado.`,
      );
    }

    const refBase = `Inventário #${inv.controlNumber}${inv.notes ? ` — ${inv.notes}` : ''}`;

    await db.$transaction(async (tx) => {
      for (const it of inv.items) {
        const counted = Number(it.countedQty);
        const bal = await tx.stockBalance.findUnique({
          where: {
            variantId_locationId: {
              variantId: it.variantId,
              locationId: inv.locationId,
            },
          },
        });
        const systemNow = bal ? Number(bal.quantity) : 0;

        await tx.stockInventoryItem.update({
          where: { id: it.id },
          data: { systemQty: String(systemNow) },
        });

        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: {
              variantId: it.variantId,
              locationId: inv.locationId,
            },
          },
          create: {
            variantId: it.variantId,
            locationId: inv.locationId,
            quantity: String(counted),
          },
          update: { quantity: String(counted) },
        });

        await tx.stockMovement.create({
          data: {
            type: StockMovementType.ADJUST,
            source: StockMovementSource.ADJUSTMENT,
            variantId: it.variantId,
            locationId: inv.locationId,
            quantity: String(counted),
            reference: refBase.slice(0, 500),
            userId,
            stockInventoryId: inv.id,
          },
        });
      }

      await tx.stockInventory.update({
        where: { id: inv.id },
        data: {
          status: StockInventoryStatus.POSTED,
          postedAt: new Date(),
        },
      });
    });

    return this.get(tenantSlug, inventoryId);
  }

  async cancel(tenantSlug: string, inventoryId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível cancelar rascunho.');
    }
    return db.stockInventory.update({
      where: { id: inventoryId },
      data: { status: StockInventoryStatus.CANCELLED },
      include: inventoryInclude,
    });
  }

  async removeDraft(tenantSlug: string, inventoryId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível excluir rascunho.');
    }
    await db.stockInventory.delete({ where: { id: inventoryId } });
    return { ok: true };
  }
}
