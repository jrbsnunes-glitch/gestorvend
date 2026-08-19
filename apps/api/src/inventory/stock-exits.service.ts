import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityLogAction,
  StockExitStatus,
  StockMovementSource,
  StockMovementType,
} from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type StockExitItemInput = {
  variantId: string;
  quantity: number | string;
  notes?: string | null;
};

export type CreateStockExitInput = {
  locationId: string;
  reason: string;
  reference?: string | null;
  items: StockExitItemInput[];
};

const QTY_EPS = 1e-9;

const EXIT_INCLUDE = {
  location: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, name: true } },
  items: {
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          product: { select: { id: true, name: true, controlNumber: true } },
        },
      },
    },
  },
};

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Saídas manuais de estoque (avaria, perda, consumo interno) como documento:
 * uma saída agrupa N produtos, baixa o saldo ao gravar e devolve tudo ao cancelar.
 */
@Injectable()
export class StockExitsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async list(
    tenantSlug: string,
    opts: { status?: string; take?: number } = {},
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const status =
      opts.status === 'POSTED' || opts.status === 'CANCELLED'
        ? (opts.status as StockExitStatus)
        : undefined;
    const take = Number.isFinite(opts.take)
      ? Math.min(Math.max(1, Number(opts.take)), 200)
      : 100;

    return db.stockExit.findMany({
      where: status ? { status } : undefined,
      include: EXIT_INCLUDE,
      orderBy: { controlNumber: 'desc' },
      take,
    });
  }

  async detail(tenantSlug: string, id: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const exit = await db.stockExit.findUnique({
      where: { id },
      include: EXIT_INCLUDE,
    });
    if (!exit) throw new NotFoundException('Saída não encontrada.');
    return exit;
  }

  /**
   * Agrupa o mesmo produto repetido no documento e valida quantidades.
   * O front já soma ao adicionar, mas a API não confia nisso (unique exitId+variantId).
   */
  private normalizeItems(items: StockExitItemInput[]) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Inclua ao menos um produto na saída.');
    }

    const merged = new Map<
      string,
      { variantId: string; quantity: number; notes: string | null }
    >();
    for (const raw of items) {
      const variantId = String(raw?.variantId ?? '').trim();
      if (!variantId)
        throw new BadRequestException('Produto inválido na lista de itens.');
      const qty = Number(raw?.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new BadRequestException(
          'Quantidade inválida — informe um valor maior que zero.',
        );
      }
      const notes =
        typeof raw?.notes === 'string' && raw.notes.trim()
          ? raw.notes.trim()
          : null;
      const current = merged.get(variantId);
      if (current) {
        current.quantity = round4(current.quantity + qty);
        current.notes = current.notes ?? notes;
      } else {
        merged.set(variantId, { variantId, quantity: round4(qty), notes });
      }
    }
    return [...merged.values()];
  }

  async create(
    tenantSlug: string,
    userId: string,
    input: CreateStockExitInput,
  ) {
    const reason = String(input?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('Informe o motivo da saída.');
    const locationId = String(input?.locationId ?? '').trim();
    if (!locationId)
      throw new BadRequestException('Informe o local de estoque.');
    const items = this.normalizeItems(input?.items ?? []);
    const reference =
      typeof input?.reference === 'string' && input.reference.trim()
        ? input.reference.trim()
        : null;

    const db = await this.tenantPrisma.getClient(tenantSlug);

    const created = await db.$transaction(async (tx) => {
      const location = await tx.stockLocation.findUnique({
        where: { id: locationId },
      });
      if (!location)
        throw new BadRequestException('Local de estoque não encontrado.');

      const exit = await tx.stockExit.create({
        data: {
          locationId,
          reason,
          reference,
          userId,
          status: StockExitStatus.POSTED,
        },
      });

      for (const item of items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { id: true, sku: true, product: { select: { name: true } } },
        });
        if (!variant)
          throw new BadRequestException('Produto não encontrado na saída.');

        const bal = await tx.stockBalance.findUnique({
          where: {
            variantId_locationId: { variantId: item.variantId, locationId },
          },
        });
        const current = bal ? Number(bal.quantity) : 0;
        const next = round4(current - item.quantity);
        if (next < -QTY_EPS) {
          throw new BadRequestException(
            `Estoque insuficiente para ${variant.product.name} (${variant.sku}) em ${location.name}: ` +
              `saldo ${current}, saída ${item.quantity}.`,
          );
        }

        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: { variantId: item.variantId, locationId },
          },
          create: {
            variantId: item.variantId,
            locationId,
            quantity: String(next),
          },
          update: { quantity: String(next) },
        });

        await tx.stockExitItem.create({
          data: {
            exitId: exit.id,
            variantId: item.variantId,
            quantity: String(item.quantity),
            notes: item.notes,
          },
        });

        await tx.stockMovement.create({
          data: {
            type: StockMovementType.OUT,
            source: StockMovementSource.MANUAL_OUT,
            variantId: item.variantId,
            locationId,
            quantity: String(item.quantity),
            reference: reference ?? `Saída #${exit.controlNumber}`,
            outboundReason: reason,
            userId,
            stockExitId: exit.id,
          },
        });
      }

      return tx.stockExit.findUniqueOrThrow({
        where: { id: exit.id },
        include: EXIT_INCLUDE,
      });
    });

    this.activityLog.record({
      tenantSlug,
      userId,
      action: ActivityLogAction.CREATE,
      summary:
        `Registrou saída de estoque #${created.controlNumber} em ${created.location.name} ` +
        `— motivo: ${reason}; ${created.items.length} produto(s)`,
      entityType: 'stock_exit',
      entityRef: `saída #${created.controlNumber}`,
    });

    return created;
  }

  /**
   * Cancela a saída e devolve ao estoque a quantidade de cada item, no mesmo
   * padrão do estorno de entrada de notas: movimento IN de contrapartida e
   * documento marcado como CANCELLED (o histórico dos dois lados permanece).
   */
  async cancel(
    tenantSlug: string,
    userId: string,
    id: string,
    notes?: string | null,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);

    const updated = await db.$transaction(async (tx) => {
      const exit = await tx.stockExit.findUnique({
        where: { id },
        include: { items: true, location: { select: { name: true } } },
      });
      if (!exit) throw new NotFoundException('Saída não encontrada.');
      if (exit.status === StockExitStatus.CANCELLED) {
        throw new BadRequestException(
          `A saída #${exit.controlNumber} já está cancelada.`,
        );
      }

      for (const item of exit.items) {
        const qty = Number(item.quantity);
        const bal = await tx.stockBalance.findUnique({
          where: {
            variantId_locationId: {
              variantId: item.variantId,
              locationId: exit.locationId,
            },
          },
        });
        const current = bal ? Number(bal.quantity) : 0;
        const next = round4(current + qty);

        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: {
              variantId: item.variantId,
              locationId: exit.locationId,
            },
          },
          create: {
            variantId: item.variantId,
            locationId: exit.locationId,
            quantity: String(next),
          },
          update: { quantity: String(next) },
        });

        await tx.stockMovement.create({
          data: {
            type: StockMovementType.IN,
            source: StockMovementSource.OTHER,
            variantId: item.variantId,
            locationId: exit.locationId,
            quantity: String(qty),
            reference: `Estorno saída #${exit.controlNumber}`,
            userId,
            stockExitId: exit.id,
          },
        });
      }

      const cancellationNotes =
        typeof notes === 'string' && notes.trim()
          ? notes.trim().slice(0, 500)
          : null;

      await tx.stockExit.update({
        where: { id: exit.id },
        data: {
          status: StockExitStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationNotes,
        },
      });

      return tx.stockExit.findUniqueOrThrow({
        where: { id: exit.id },
        include: EXIT_INCLUDE,
      });
    });

    this.activityLog.record({
      tenantSlug,
      userId,
      action: ActivityLogAction.DELETE,
      summary:
        `Cancelou a saída de estoque #${updated.controlNumber} — ` +
        `${updated.items.length} produto(s) devolvido(s) ao estoque em ${updated.location.name}` +
        (updated.cancellationNotes
          ? ` — motivo: ${updated.cancellationNotes}`
          : ''),
      entityType: 'stock_exit',
      entityRef: `saída #${updated.controlNumber}`,
    });

    return updated;
  }
}
