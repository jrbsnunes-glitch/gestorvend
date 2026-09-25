import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

function parseQty(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class ProductRecipeService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async getRecipe(tenantSlug: string, productId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
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
    const db = await this.tenantPrisma.getClient(tenantSlug);
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
