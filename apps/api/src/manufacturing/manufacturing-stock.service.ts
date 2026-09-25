import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ManufacturingConsumePhase,
  ManufacturingProjectStatus,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

type Db = Awaited<ReturnType<TenantPrismaService['getClient']>>;

async function defaultLocation(db: Db) {
  const co = await db.company.findFirst({
    select: { factoryStockLocationId: true },
  });
  if (co?.factoryStockLocationId) {
    const loc = await db.stockLocation.findUnique({
      where: { id: co.factoryStockLocationId },
    });
    if (loc) return loc;
  }
  return db.stockLocation.findFirst({
    where: { isDefault: true },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

function roundQty(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

@Injectable()
export class ManufacturingStockService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** Saldo − reservas ativas (outros projetos). */
  async availableQty(
    db: Db,
    variantId: string,
    excludeProjectId?: string,
  ): Promise<number> {
    const loc = await defaultLocation(db);
    if (!loc) return 0;
    const bal = await db.stockBalance.findUnique({
      where: { variantId_locationId: { variantId, locationId: loc.id } },
    });
    const onHand = bal ? Number(bal.quantity) : 0;
    const reserved = await db.manufacturingMaterialReservation.aggregate({
      where: {
        ingredientVariantId: variantId,
        active: true,
        ...(excludeProjectId ? { projectId: { not: excludeProjectId } } : {}),
      },
      _sum: { quantity: true },
    });
    return roundQty(onHand - Number(reserved._sum.quantity ?? 0));
  }

  async syncBomFromRecipe(tenantSlug: string, projectId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const project = await db.manufacturingProject.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        finishedVariant: {
          include: {
            product: { include: { recipe: { include: { items: true } } } },
          },
        },
      },
    });
    const recipe = project.finishedVariant.product.recipe;
    if (!recipe?.items.length) {
      throw new BadRequestException('Produto acabado sem ficha técnica (BOM).');
    }
    const qty = Number(project.quantity);
    await db.$transaction(async (tx) => {
      await tx.manufacturingBomLine.deleteMany({ where: { projectId } });
      let sort = 0;
      for (const ri of recipe.items) {
        const planned = roundQty(qty * Number(ri.quantity));
        await tx.manufacturingBomLine.create({
          data: {
            projectId,
            ingredientVariantId: ri.ingredientVariantId,
            plannedQty: planned,
            sortOrder: sort++,
          },
        });
      }
    });
  }

  async assertAvailabilityForReservations(tenantSlug: string, projectId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const lines = await db.manufacturingBomLine.findMany({ where: { projectId } });
    for (const line of lines) {
      const need = Number(line.plannedQty) * (1 + Number(line.scrapPct) / 100);
      const avail = await this.availableQty(db, line.ingredientVariantId, projectId);
      if (avail + 1e-9 < need) {
        const ing = await db.productVariant.findUnique({
          where: { id: line.ingredientVariantId },
          include: { product: { select: { name: true } } },
        });
        throw new BadRequestException(
          `Estoque insuficiente para "${ing?.product.name ?? line.ingredientVariantId}" (disp. ${avail}, necessário ${roundQty(need)}).`,
        );
      }
    }
  }

  async createReservations(tenantSlug: string, projectId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    await this.assertAvailabilityForReservations(tenantSlug, projectId);
    const lines = await db.manufacturingBomLine.findMany({ where: { projectId } });
    await db.$transaction(async (tx) => {
      for (const line of lines) {
        const need = roundQty(Number(line.plannedQty) * (1 + Number(line.scrapPct) / 100));
        await tx.manufacturingMaterialReservation.create({
          data: {
            projectId,
            bomLineId: line.id,
            ingredientVariantId: line.ingredientVariantId,
            quantity: need,
            active: true,
          },
        });
        await tx.manufacturingBomLine.update({
          where: { id: line.id },
          data: { reservedQty: need },
        });
      }
    });
  }

  async releaseReservations(tenantSlug: string, projectId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    await db.manufacturingMaterialReservation.updateMany({
      where: { projectId, active: true },
      data: { active: false, releasedAt: new Date() },
    });
    await db.manufacturingBomLine.updateMany({
      where: { projectId },
      data: { reservedQty: 0 },
    });
  }

  private async issueLine(
    tx: Prisma.TransactionClient,
    opts: {
      projectId: string;
      projectNumber: number;
      userId: string;
      line: { id: string; ingredientVariantId: string; plannedQty: Prisma.Decimal; scrapPct: Prisma.Decimal; consumedQty: Prisma.Decimal; issueAtStart: boolean };
      quantity: number;
      phase: ManufacturingConsumePhase;
      locationId: string;
    },
  ) {
    if (opts.quantity <= 0) return;
    const bal = await tx.stockBalance.findUnique({
      where: {
        variantId_locationId: {
          variantId: opts.line.ingredientVariantId,
          locationId: opts.locationId,
        },
      },
    });
    const onHand = bal ? Number(bal.quantity) : 0;
    if (onHand + 1e-9 < opts.quantity) {
      throw new BadRequestException('Estoque insuficiente para baixa de fabricação.');
    }
    const next = onHand - opts.quantity;
    await tx.stockBalance.upsert({
      where: {
        variantId_locationId: {
          variantId: opts.line.ingredientVariantId,
          locationId: opts.locationId,
        },
      },
      create: {
        variantId: opts.line.ingredientVariantId,
        locationId: opts.locationId,
        quantity: String(next),
      },
      update: { quantity: String(next) },
    });
    const mov = await tx.stockMovement.create({
      data: {
        type: StockMovementType.OUT,
        source: StockMovementSource.MANUFACTURING,
        variantId: opts.line.ingredientVariantId,
        locationId: opts.locationId,
        quantity: String(opts.quantity),
        reference: `MF:${opts.projectNumber}`,
        outboundReason: `Consumo fabricação (${opts.phase})`,
        userId: opts.userId,
      },
    });
    await tx.manufacturingMaterialIssue.create({
      data: {
        projectId: opts.projectId,
        bomLineId: opts.line.id,
        ingredientVariantId: opts.line.ingredientVariantId,
        quantity: opts.quantity,
        phase: opts.phase,
        userId: opts.userId,
        stockMovementId: mov.id,
      },
    });
    const newConsumed = roundQty(Number(opts.line.consumedQty) + opts.quantity);
    await tx.manufacturingBomLine.update({
      where: { id: opts.line.id },
      data: { consumedQty: newConsumed },
    });
  }

  async issueForPhaseTransition(
    tenantSlug: string,
    projectId: string,
    userId: string,
    toStatus: ManufacturingProjectStatus,
    factoryIssuePctAtStart: number,
    factoryIssuePctDevelopment: number,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const loc = await defaultLocation(db);
    if (!loc) throw new BadRequestException('Cadastre um local de estoque padrão.');

    const project = await db.manufacturingProject.findUniqueOrThrow({
      where: { id: projectId },
      include: { bomLines: true },
    });

    const phase =
      toStatus === ManufacturingProjectStatus.STARTED
        ? ManufacturingConsumePhase.STARTED
        : toStatus === ManufacturingProjectStatus.IN_DEVELOPMENT
          ? ManufacturingConsumePhase.IN_DEVELOPMENT
          : toStatus === ManufacturingProjectStatus.TESTING
            ? ManufacturingConsumePhase.TESTING
            : null;
    if (!phase) return;

    await db.$transaction(async (tx) => {
      for (const line of project.bomLines) {
        const planned = roundQty(Number(line.plannedQty) * (1 + Number(line.scrapPct) / 100));
        const already = Number(line.consumedQty);
        const remaining = Math.max(0, planned - already);
        if (remaining <= 0) continue;

        let toIssue = 0;
        if (phase === ManufacturingConsumePhase.STARTED) {
          if (line.issueAtStart) toIssue = remaining;
          else toIssue = roundQty((planned * factoryIssuePctAtStart) / 100);
        } else if (phase === ManufacturingConsumePhase.IN_DEVELOPMENT) {
          toIssue = roundQty((planned * factoryIssuePctDevelopment) / 100);
          toIssue = Math.min(toIssue, remaining);
        } else if (phase === ManufacturingConsumePhase.TESTING) {
          continue;
        }
        toIssue = Math.min(toIssue, remaining);
        if (toIssue <= 0) continue;
        await this.issueLine(tx, {
          projectId,
          projectNumber: project.number,
          userId,
          line,
          quantity: toIssue,
          phase,
          locationId: loc.id,
        });
      }
    });
  }

  async finishProject(tenantSlug: string, projectId: string, userId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const loc = await defaultLocation(db);
    if (!loc) throw new BadRequestException('Cadastre um local de estoque padrão.');

    const project = await db.manufacturingProject.findUniqueOrThrow({
      where: { id: projectId },
      include: { bomLines: true, finishedReceipt: true },
    });
    if (project.finishedReceipt) return;

    await db.$transaction(async (tx) => {
      for (const line of project.bomLines) {
        const planned = roundQty(Number(line.plannedQty) * (1 + Number(line.scrapPct) / 100));
        const remaining = roundQty(Math.max(0, planned - Number(line.consumedQty)));
        if (remaining > 0) {
          await this.issueLine(tx, {
            projectId,
            projectNumber: project.number,
            userId,
            line,
            quantity: remaining,
            phase: ManufacturingConsumePhase.FINISHED,
            locationId: loc.id,
          });
        }
      }

      const qtyIn = Number(project.quantity);
      const bal = await tx.stockBalance.findUnique({
        where: {
          variantId_locationId: {
            variantId: project.finishedVariantId,
            locationId: loc.id,
          },
        },
      });
      const onHand = bal ? Number(bal.quantity) : 0;
      const next = onHand + qtyIn;
      await tx.stockBalance.upsert({
        where: {
          variantId_locationId: {
            variantId: project.finishedVariantId,
            locationId: loc.id,
          },
        },
        create: {
          variantId: project.finishedVariantId,
          locationId: loc.id,
          quantity: String(next),
        },
        update: { quantity: String(next) },
      });
      const mov = await tx.stockMovement.create({
        data: {
          type: StockMovementType.IN,
          source: StockMovementSource.MANUFACTURING,
          variantId: project.finishedVariantId,
          locationId: loc.id,
          quantity: String(qtyIn),
          reference: `MF:${project.number}`,
          userId,
        },
      });
      await tx.manufacturingFinishedReceipt.create({
        data: {
          projectId,
          quantity: qtyIn,
          stockMovementId: mov.id,
        },
      });
    });

    await this.releaseReservations(tenantSlug, projectId);
  }

  /** Acrescenta quantidade planejada (perda, retrabalho, insumo extra). Opcional baixa imediata. */
  async addAdditionalPlannedQty(
    tenantSlug: string,
    projectId: string,
    userId: string,
    opts: {
      ingredientVariantId: string;
      quantity: number;
      reason?: string | null;
      issueNow?: boolean;
    },
  ): Promise<{ bomLineId: string; ingredientName: string }> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const project = await db.manufacturingProject.findUniqueOrThrow({
      where: { id: projectId },
    });
    if (
      project.status === ManufacturingProjectStatus.FINISHED ||
      project.status === ManufacturingProjectStatus.CANCELLED
    ) {
      throw new BadRequestException('Projeto encerrado.');
    }
    const addQty = roundQty(opts.quantity);
    if (addQty <= 0) throw new BadRequestException('Quantidade inválida.');

    const variant = await db.productVariant.findUnique({
      where: { id: opts.ingredientVariantId },
      include: { product: { select: { name: true } } },
    });
    if (!variant) throw new BadRequestException('Insumo (SKU) inválido.');

    let bomLineId = '';
    await db.$transaction(async (tx) => {
      let line = await tx.manufacturingBomLine.findUnique({
        where: {
          projectId_ingredientVariantId: {
            projectId,
            ingredientVariantId: opts.ingredientVariantId,
          },
        },
      });
      if (line) {
        const newPlanned = roundQty(Number(line.plannedQty) + addQty);
        line = await tx.manufacturingBomLine.update({
          where: { id: line.id },
          data: { plannedQty: newPlanned },
        });
      } else {
        const maxSort = await tx.manufacturingBomLine.aggregate({
          where: { projectId },
          _max: { sortOrder: true },
        });
        line = await tx.manufacturingBomLine.create({
          data: {
            projectId,
            ingredientVariantId: opts.ingredientVariantId,
            plannedQty: addQty,
            sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          },
        });
      }
      bomLineId = line.id;

      const activeRes = await tx.manufacturingMaterialReservation.findFirst({
        where: { projectId, active: true },
      });
      if (activeRes) {
        const deltaNeed = roundQty(addQty * (1 + Number(line.scrapPct) / 100));
        const avail = await this.availableQty(db, opts.ingredientVariantId, projectId);
        if (avail + 1e-9 < deltaNeed) {
          throw new BadRequestException(
            `Estoque insuficiente para reservar insumo adicional (disp. ${avail}, necessário ${deltaNeed}).`,
          );
        }
        const resLine = await tx.manufacturingMaterialReservation.findFirst({
          where: { projectId, bomLineId: line.id, active: true },
        });
        if (resLine) {
          await tx.manufacturingMaterialReservation.update({
            where: { id: resLine.id },
            data: { quantity: roundQty(Number(resLine.quantity) + deltaNeed) },
          });
        } else {
          await tx.manufacturingMaterialReservation.create({
            data: {
              projectId,
              bomLineId: line.id,
              ingredientVariantId: opts.ingredientVariantId,
              quantity: deltaNeed,
              active: true,
            },
          });
        }
        await tx.manufacturingBomLine.update({
          where: { id: line.id },
          data: {
            reservedQty: roundQty(Number(line.reservedQty) + deltaNeed),
          },
        });
      }

      const reason = opts.reason?.trim();
      const noteParts = [
        `Insumo adicional: ${variant.product.name} +${addQty}`,
        reason ? `Motivo: ${reason}` : null,
      ].filter(Boolean);
      await tx.manufacturingStatusLog.create({
        data: {
          projectId,
          fromStatus: project.status,
          toStatus: project.status,
          userId,
          note: noteParts.join('. '),
        },
      });
    });

    if (opts.issueNow) {
      await this.manualIssue(tenantSlug, projectId, userId, bomLineId, addQty);
    }

    return { bomLineId, ingredientName: variant.product.name };
  }

  async manualIssue(
    tenantSlug: string,
    projectId: string,
    userId: string,
    bomLineId: string,
    quantity: number,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const loc = await defaultLocation(db);
    if (!loc) throw new BadRequestException('Cadastre um local de estoque padrão.');
    const project = await db.manufacturingProject.findUniqueOrThrow({ where: { id: projectId } });
    const line = await db.manufacturingBomLine.findFirstOrThrow({
      where: { id: bomLineId, projectId },
    });
    const q = roundQty(quantity);
    if (q <= 0) throw new BadRequestException('Quantidade inválida.');
    await db.$transaction(async (tx) => {
      await this.issueLine(tx, {
        projectId,
        projectNumber: project.number,
        userId,
        line,
        quantity: q,
        phase: ManufacturingConsumePhase.MANUAL,
        locationId: loc.id,
      });
    });
  }
}
