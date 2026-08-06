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
import { PrintingService } from '../printing/printing.service';

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseQty(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Cliente de balcão/mesa quando o nome não é informado. */
export const DEFAULT_WALK_IN_CUSTOMER_NAME = 'Cliente Padrão';

type TenantDb = Awaited<ReturnType<TenantPrismaService['getClient']>>;

@Injectable()
export class RestaurantService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tenants: TenantService,
    private readonly sales: SalesService,
    private readonly company: CompanyService,
    private readonly printing: PrintingService,
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

  /**
   * Mesa fica OCCUPIED só com comanda aberta que tenha cliente ou item ativo.
   * Comanda vazia (só reserva de número) mantém a mesa livre.
   */
  private async syncDiningTableStatus(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    tableId: string | null | undefined,
  ) {
    if (!tableId) return;
    const openTabs = await db.serviceTab.findMany({
      where: { tableId, status: ServiceTabStatus.OPEN },
      select: {
        customerId: true,
        items: {
          where: { status: { not: ServiceTabItemStatus.CANCELLED } },
          select: { id: true },
          take: 1,
        },
      },
    });
    const occupied = openTabs.some((t) => Boolean(t.customerId) || t.items.length > 0);
    await db.diningTable.update({
      where: { id: tableId },
      data: {
        status: occupied ? DiningTableStatus.OCCUPIED : DiningTableStatus.FREE,
      },
    });
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
                select: {
                  id: true,
                  number: true,
                  customerId: true,
                  customer: { select: { id: true, name: true } },
                  _count: {
                    select: {
                      items: {
                        where: { status: { not: ServiceTabItemStatus.CANCELLED } },
                      },
                    },
                  },
                },
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

  async updateArea(tenantSlug: string, id: string, body: { name?: string; sortOrder?: number }) {
    const db = await this.db(tenantSlug);
    const current = await db.diningArea.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Ambiente não encontrado.');
    const data: { name?: string; sortOrder?: number } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestException('Nome do ambiente é obrigatório.');
      data.name = name;
    }
    if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0;
    return db.diningArea.update({ where: { id }, data });
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

  async updateTable(
    tenantSlug: string,
    id: string,
    body: { areaId?: string; code?: string; label?: string | null; capacity?: number | null },
  ) {
    const db = await this.db(tenantSlug);
    const current = await db.diningTable.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Mesa não encontrada.');

    const data: {
      areaId?: string;
      code?: string;
      label?: string | null;
      capacity?: number | null;
    } = {};

    if (body.areaId !== undefined) {
      const areaId = String(body.areaId).trim();
      if (!areaId) throw new BadRequestException('Ambiente da mesa é obrigatório.');
      const area = await db.diningArea.findUnique({ where: { id: areaId } });
      if (!area) throw new NotFoundException('Ambiente não encontrado.');
      data.areaId = areaId;
    }
    if (body.code !== undefined) {
      const code = String(body.code).trim();
      if (!code) throw new BadRequestException('Código da mesa é obrigatório.');
      data.code = code;
    }
    if (body.label !== undefined) data.label = body.label?.trim() || null;
    if (body.capacity !== undefined) {
      data.capacity = body.capacity == null ? null : Number(body.capacity) || null;
    }

    // Código é único dentro do ambiente: valida antes para devolver mensagem clara.
    const nextAreaId = data.areaId ?? current.areaId;
    const nextCode = data.code ?? current.code;
    if (nextAreaId !== current.areaId || nextCode !== current.code) {
      const clash = await db.diningTable.findFirst({
        where: { areaId: nextAreaId, code: nextCode, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException(`Já existe a mesa ${nextCode} nesse ambiente.`);
      }
    }

    return db.diningTable.update({ where: { id }, data });
  }

  // --- Comandas fixas (sem mesa) ---

  listStations(tenantSlug: string) {
    return this.db(tenantSlug).then((db) =>
      db.comandaStation.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        include: {
          tabs: {
            where: { status: ServiceTabStatus.OPEN },
            select: {
              id: true,
              number: true,
              customerId: true,
              customer: { select: { id: true, name: true } },
              _count: {
                select: {
                  items: {
                    where: { status: { not: ServiceTabItemStatus.CANCELLED } },
                  },
                },
              },
            },
          },
        },
      }),
    );
  }

  async createStation(
    tenantSlug: string,
    body: { code: string; label?: string | null; sortOrder?: number },
  ) {
    const db = await this.db(tenantSlug);
    const code = String(body.code ?? '').trim();
    if (!code) throw new BadRequestException('Número ou sigla da comanda é obrigatório.');
    const company = await db.company.findFirst({ select: { comandaNumberingMode: true } });
    if (company?.comandaNumberingMode !== 'FIXED') {
      throw new BadRequestException(
        'Cadastro de comandas fixas só está disponível com numeração fixa em Empresa → Restaurante.',
      );
    }
    return db.comandaStation.create({
      data: {
        code,
        label: body.label?.trim() || null,
        sortOrder: body.sortOrder ?? 0,
      },
    });
  }

  async updateStation(
    tenantSlug: string,
    id: string,
    body: { code?: string; label?: string | null; sortOrder?: number },
  ) {
    const db = await this.db(tenantSlug);
    const current = await db.comandaStation.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Comanda não encontrada.');

    const data: { code?: string; label?: string | null; sortOrder?: number } = {};
    if (body.code !== undefined) {
      const code = String(body.code).trim();
      if (!code) throw new BadRequestException('Número ou sigla da comanda é obrigatório.');
      if (code !== current.code) {
        const clash = await db.comandaStation.findFirst({
          where: { code, id: { not: id } },
          select: { id: true },
        });
        if (clash) throw new BadRequestException(`Já existe a comanda ${code}.`);
      }
      data.code = code;
    }
    if (body.label !== undefined) data.label = body.label?.trim() || null;
    if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0;

    return db.comandaStation.update({ where: { id }, data });
  }

  // --- Comandas ---

  private readonly tabDetailInclude = {
    table: { include: { area: true } },
    station: true,
    items: {
      include: {
        variant: {
          include: { product: { select: { id: true, name: true, taxUnit: true, tareKg: true } } },
        },
      },
      orderBy: { createdAt: 'asc' as const },
    },
    customer: true,
    openedBy: { select: { id: true, name: true } },
    sale: { select: { id: true, number: true, total: true } },
  };

  async listOpenTabs(tenantSlug: string) {
    const db = await this.db(tenantSlug);
    return db.serviceTab.findMany({
      where: { status: ServiceTabStatus.OPEN },
      orderBy: { number: 'asc' },
      include: {
        table: { include: { area: true } },
        station: true,
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
      include: this.tabDetailInclude,
    });
    if (!tab) throw new NotFoundException('Comanda não encontrada.');
    return tab;
  }

  /**
   * Localiza comanda aberta por número da comanda ou código/rótulo da mesa.
   * Usado pelo PDV para cobrança sem depender do link do salão.
   */
  async lookupOpenTab(tenantSlug: string, q: string) {
    const db = await this.db(tenantSlug);
    const term = String(q ?? '').trim();
    if (!term) {
      throw new BadRequestException('Informe o número da comanda ou o código da mesa.');
    }

    const asPureNumber = /^\d+$/.test(term) && term.length <= 10;
    /** "01" / "001" costuma ser código de mesa, não comanda #1. */
    const preferTableCode = asPureNumber && /^0\d+$/.test(term);

    if (asPureNumber && !preferTableCode) {
      const n = Number(term);
      const byNumber = await db.serviceTab.findFirst({
        where: { number: n, status: ServiceTabStatus.OPEN },
        include: this.tabDetailInclude,
      });
      if (byNumber) return { match: 'number' as const, tab: byNumber, candidates: [] as never[] };
    }

    const tables = await db.diningTable.findMany({
      where: {
        isActive: true,
        OR: [
          { code: { equals: term, mode: 'insensitive' } },
          { label: { equals: term, mode: 'insensitive' } },
        ],
      },
      include: {
        area: true,
        tabs: {
          where: { status: ServiceTabStatus.OPEN },
          orderBy: { number: 'asc' },
          include: this.tabDetailInclude,
        },
      },
    });

    const openFromTables = tables.flatMap((t) => t.tabs);
    if (openFromTables.length === 1) {
      return { match: 'table' as const, tab: openFromTables[0]!, candidates: [] as never[] };
    }
    if (openFromTables.length > 1) {
      return {
        match: 'ambiguous' as const,
        tab: null,
        candidates: openFromTables.map((t) => ({
          id: t.id,
          number: t.number,
          tableLabel: t.table
            ? `${t.table.area.name} / ${t.table.label || t.table.code}`
            : 'sem mesa',
          itemCount: t.items.filter((i) => i.status !== ServiceTabItemStatus.CANCELLED).length,
          total: t.items
            .filter((i) => i.status !== ServiceTabItemStatus.CANCELLED)
            .reduce((s, i) => s + Number(i.totalLine), 0),
        })),
      };
    }

    /** Fallback: "01" sem mesa → tenta comanda #1. */
    if (preferTableCode) {
      const n = Number(term);
      const byNumber = await db.serviceTab.findFirst({
        where: { number: n, status: ServiceTabStatus.OPEN },
        include: this.tabDetailInclude,
      });
      if (byNumber) return { match: 'number' as const, tab: byNumber, candidates: [] as never[] };
    }

    throw new NotFoundException(
      `Nenhuma comanda aberta para "${term}". Use o nº da comanda ou o código da mesa.`,
    );
  }

  private async resolveCustomerId(
    db: TenantDb,
    opts: { customerId?: string | null; customerName?: string | null },
  ): Promise<string> {
    if (opts.customerId?.trim()) {
      const byId = await db.customer.findUnique({
        where: { id: opts.customerId.trim() },
        select: { id: true },
      });
      if (!byId) throw new BadRequestException('Cliente inválido.');
      return byId.id;
    }
    const name = (opts.customerName?.trim() || DEFAULT_WALK_IN_CUSTOMER_NAME).slice(0, 120);
    const found = await db.customer.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (found) return found.id;
    const created = await db.customer.create({
      data: { name },
      select: { id: true },
    });
    return created.id;
  }

  async openTab(
    tenantSlug: string,
    userId: string,
    body: {
      tableId?: string | null;
      stationId?: string | null;
      customerId?: string | null;
      customerName?: string | null;
      notes?: string | null;
      guestCount?: number;
    },
  ) {
    const db = await this.db(tenantSlug);
    const company = await db.company.findFirst({
      select: { comandaNumberingMode: true },
    });
    const numberingMode = company?.comandaNumberingMode ?? 'DYNAMIC';

    let tableId = body.tableId?.trim() || null;
    let stationId = body.stationId?.trim() || null;

    if (tableId && stationId) {
      throw new BadRequestException('Comanda não pode ter mesa e número fixo ao mesmo tempo.');
    }

    if (stationId) {
      if (numberingMode !== 'FIXED') {
        throw new BadRequestException(
          'Numeração fixa não está ativa. Ative em Empresa → Restaurante.',
        );
      }
      const station = await db.comandaStation.findUnique({ where: { id: stationId } });
      if (!station || !station.isActive) {
        throw new BadRequestException('Comanda fixa inválida ou inativa.');
      }
      const openOnStation = await db.serviceTab.findFirst({
        where: { stationId, status: ServiceTabStatus.OPEN },
        select: { id: true },
      });
      if (openOnStation) {
        throw new BadRequestException('Já existe comanda aberta neste número/sigla.');
      }
    } else if (!tableId && numberingMode === 'FIXED') {
      throw new BadRequestException(
        'Selecione uma comanda cadastrada (numeração fixa).',
      );
    }

    if (tableId) {
      const table = await db.diningTable.findUnique({ where: { id: tableId } });
      if (!table || !table.isActive) throw new BadRequestException('Mesa inválida.');
    }
    let guestCount = 1;
    if (body.guestCount !== undefined) {
      const n = Math.floor(Number(body.guestCount));
      if (!Number.isFinite(n) || n < 1 || n > 999) {
        throw new BadRequestException('Número de pessoas inválido (1–999).');
      }
      guestCount = n;
    }
    const customerId = await this.resolveCustomerId(db, {
      customerId: body.customerId,
      customerName: body.customerName,
    });
    const tab = await db.serviceTab.create({
      data: {
        tableId,
        stationId,
        customerId,
        notes: body.notes?.trim() || null,
        openedById: userId,
        guestCount,
      },
      include: this.tabDetailInclude,
    });
    await this.syncDiningTableStatus(db, tableId);
    return tab;
  }

  async patchTab(
    tenantSlug: string,
    tabId: string,
    body: {
      guestCount?: number;
      customerId?: string | null;
      customerName?: string | null;
      notes?: string | null;
    },
  ) {
    const db = await this.db(tenantSlug);
    const tab = await db.serviceTab.findUnique({ where: { id: tabId } });
    if (!tab) throw new NotFoundException('Comanda não encontrada.');
    if (tab.status !== ServiceTabStatus.OPEN) {
      throw new BadRequestException('Comanda não está aberta.');
    }
    const data: { guestCount?: number; customerId?: string | null; notes?: string | null } = {};
    if (body.guestCount !== undefined) {
      const n = Math.floor(Number(body.guestCount));
      if (!Number.isFinite(n) || n < 1 || n > 999) {
        throw new BadRequestException('Número de pessoas inválido (1–999).');
      }
      data.guestCount = n;
    }
    if (body.customerId !== undefined || body.customerName !== undefined) {
      data.customerId = await this.resolveCustomerId(db, {
        customerId: body.customerId,
        customerName: body.customerName,
      });
    }
    if (body.notes !== undefined) {
      data.notes = body.notes?.trim() || null;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nada para atualizar.');
    }
    const updated = await db.serviceTab.update({
      where: { id: tabId },
      data,
      include: this.tabDetailInclude,
    });
    await this.syncDiningTableStatus(db, updated.tableId);
    return updated;
  }

  async addItem(
    tenantSlug: string,
    userId: string,
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

    // Baixa estoque no lançamento (comanda). A venda no PDV não baixa de novo.
    await this.sales.consumeStockForLines(
      tenantSlug,
      userId,
      [{ variantId: body.variantId, quantity: qty }],
      `Comanda #${tab.number}`,
    );

    const created = await db.serviceTabItem.create({
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
    await this.syncDiningTableStatus(db, tab.tableId);
    return created;
  }

  async cancelItem(tenantSlug: string, userId: string, tabId: string, itemId: string) {
    const db = await this.db(tenantSlug);
    const item = await db.serviceTabItem.findFirst({ where: { id: itemId, tabId } });
    if (!item) throw new NotFoundException('Item não encontrado.');
    if (item.status === ServiceTabItemStatus.CANCELLED) {
      return item;
    }
    const tab = await db.serviceTab.findUnique({ where: { id: tabId } });
    await this.sales.restoreStockForLines(
      tenantSlug,
      userId,
      [{ variantId: item.variantId, quantity: Number(item.quantity) }],
      `Comanda #${tab?.number ?? '?'} — cancelamento item`,
    );
    const updated = await db.serviceTabItem.update({
      where: { id: itemId },
      data: { status: ServiceTabItemStatus.CANCELLED },
    });
    await this.syncDiningTableStatus(db, tab?.tableId);
    return updated;
  }

  async cancelTab(tenantSlug: string, userId: string, tabId: string) {
    const db = await this.db(tenantSlug);
    const tab = await db.serviceTab.findUnique({
      where: { id: tabId },
      include: {
        items: { where: { status: { not: ServiceTabItemStatus.CANCELLED } } },
      },
    });
    if (!tab) throw new NotFoundException('Comanda não encontrada.');
    if (tab.status !== ServiceTabStatus.OPEN) {
      throw new BadRequestException('Só é possível cancelar comanda aberta.');
    }
    if (tab.items.length) {
      await this.sales.restoreStockForLines(
        tenantSlug,
        userId,
        tab.items.map((it) => ({
          variantId: it.variantId,
          quantity: Number(it.quantity),
        })),
        `Comanda #${tab.number} — cancelamento`,
      );
    }
    const updated = await db.serviceTab.update({
      where: { id: tabId },
      data: { status: ServiceTabStatus.CANCELLED, closedAt: new Date() },
    });
    await this.syncDiningTableStatus(db, tab.tableId);
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
    const pending = await db.serviceTabItem.findMany({
      where,
      include: {
        variant: {
          include: { product: { select: { name: true, taxUnit: true } } },
        },
      },
    });
    const printedItemIds = pending.map((i) => i.id);

    const alreadyPrintedCount = await db.serviceTabItem.count({
      where: {
        tabId,
        kitchenPrintedAt: { not: null },
        status: { not: ServiceTabItemStatus.CANCELLED },
        ...(printedItemIds.length ? { id: { notIn: printedItemIds } } : {}),
      },
    });
    const additional = alreadyPrintedCount > 0;

    if (printedItemIds.length) {
      await db.serviceTabItem.updateMany({
        where: { id: { in: printedItemIds } },
        data: { kitchenPrintedAt: new Date(), status: ServiceTabItemStatus.PREPARING },
      });
    }

    const tab = await this.getTab(tenantSlug, tabId);
    let dispatched = false;
    let stationName: string | null = null;
    let stationNames: string[] = [];
    let jobIds: string[] = [];

    if (pending.length) {
      const enqueue = await this.printing.enqueueKitchenJobs(
        tenantSlug,
        {
          id: tab.id,
          number: tab.number,
          guestCount: tab.guestCount,
          table: tab.table
            ? {
                code: tab.table.code,
                label: tab.table.label,
                area: tab.table.area ? { name: tab.table.area.name } : null,
              }
            : null,
          openedBy: tab.openedBy ? { name: tab.openedBy.name } : null,
        },
        pending.map((it) => ({
          id: it.id,
          quantity: it.quantity,
          notes: it.notes,
          printSector: it.printSector,
          kitchenPrintedAt: it.kitchenPrintedAt,
          variant: it.variant,
        })),
        { additional },
      );
      dispatched = enqueue.dispatched;
      stationName = enqueue.stationName;
      stationNames = enqueue.stationNames;
      jobIds = enqueue.jobIds;
    }

    return {
      ...tab,
      printedItemIds,
      dispatched,
      stationName,
      stationNames,
      jobIds,
    };
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
      deductStock: false,
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
      await this.syncDiningTableStatus(db, tab.tableId);
    }

    return { tab: await this.getTab(tenantSlug, tabId), sale };
  }

  /**
   * Fecha a comanda após o PDV já ter criado a Sale (pagamento no caixa).
   * Não cria venda de novo — só vincula e libera a mesa.
   */
  async closeTabWithSale(tenantSlug: string, tabId: string, saleId: string) {
    const db = await this.db(tenantSlug);
    const tab = await db.serviceTab.findUnique({ where: { id: tabId } });
    if (!tab) throw new NotFoundException('Comanda não encontrada.');
    if (tab.status !== ServiceTabStatus.OPEN) {
      throw new BadRequestException('Comanda já fechada ou cancelada.');
    }
    const sale = await db.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Venda inválida.');
    if (sale.status !== 'COMPLETED') {
      throw new BadRequestException('Só é possível vincular venda concluída.');
    }

    const updated = await db.serviceTab.update({
      where: { id: tabId },
      data: {
        status: ServiceTabStatus.CLOSED,
        closedAt: new Date(),
        saleId: sale.id,
      },
    });

    await this.syncDiningTableStatus(db, tab.tableId);

    return { tab: await this.getTab(tenantSlug, tabId), sale: updated };
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
