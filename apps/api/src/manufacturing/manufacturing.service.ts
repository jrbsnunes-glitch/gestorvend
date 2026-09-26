import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityLogAction,
  ManufacturingProjectSource,
  ManufacturingProjectStatus,
  Prisma,
} from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { endOfDay, formatLocalDateISO, parseQueryDate, startOfDay } from '../common/date-range.util';
import { CompanyService } from '../company/company.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ManufacturingStockService } from './manufacturing-stock.service';

/** Campo só-dia (input type=date): meia-noite local, não UTC. */
function parsePromisedAtLocal(raw: string | null | undefined): Date | null {
  if (raw == null || !String(raw).trim()) return null;
  const parsed = parseQueryDate(String(raw).trim(), 'start');
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Prazo prometido inválido (use YYYY-MM-DD).');
  }
  return parsed;
}

type ActingUser = { sub: string; roles: string[] };

const ALLOWED: Record<ManufacturingProjectStatus, ManufacturingProjectStatus[]> = {
  PRODUCT_SELECTION: [ManufacturingProjectStatus.QUOTE, ManufacturingProjectStatus.CANCELLED],
  QUOTE: [
    ManufacturingProjectStatus.STARTED,
    ManufacturingProjectStatus.PRODUCT_SELECTION,
    ManufacturingProjectStatus.CANCELLED,
  ],
  STARTED: [ManufacturingProjectStatus.IN_DEVELOPMENT, ManufacturingProjectStatus.CANCELLED],
  IN_DEVELOPMENT: [
    ManufacturingProjectStatus.TESTING,
    ManufacturingProjectStatus.CANCELLED,
  ],
  TESTING: [
    ManufacturingProjectStatus.FINISHED,
    ManufacturingProjectStatus.IN_DEVELOPMENT,
    ManufacturingProjectStatus.CANCELLED,
  ],
  FINISHED: [],
  CANCELLED: [],
};

const PROJECT_INCLUDE = {
  customer: { select: { id: true, name: true, document: true, phone: true, email: true } },
  finishedVariant: {
    select: {
      id: true,
      sku: true,
      retailPrice: true,
      product: { select: { id: true, name: true, controlNumber: true, isManufacturedFinishedGood: true } },
    },
  },
  openedBy: { select: { id: true, name: true } },
  technicalResponsible: { select: { id: true, name: true } },
  commercialResponsible: { select: { id: true, name: true } },
  bomLines: {
    include: {
      ingredientVariant: {
        select: {
          id: true,
          sku: true,
          product: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { sortOrder: 'asc' as const },
  },
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  materialIssues: { orderBy: { createdAt: 'desc' as const }, take: 80 },
  sale: { select: { id: true, number: true, total: true, status: true } },
  depositSale: { select: { id: true, number: true, total: true, status: true } },
} satisfies Prisma.ManufacturingProjectInclude;

function parseQty(raw: unknown, label: string): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`${label} inválido.`);
  return n;
}

@Injectable()
export class ManufacturingService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly company: CompanyService,
    private readonly stock: ManufacturingStockService,
    private readonly activityLog: ActivityLogService,
  ) {}

  private async assertModule(tenantSlug: string) {
    const co = await this.company.getOrCreate(tenantSlug);
    if (!co.factoryModuleEnabled) {
      throw new ForbiddenException(
        'Módulo Fábrica desativado na Empresa. Ative em Cadastro da empresa → Fábrica.',
      );
    }
    return co;
  }

  private serialize(project: any) {
    return {
      ...project,
      quantity: String(project.quantity),
      quoteTotal: project.quoteTotal != null ? String(project.quoteTotal) : null,
      depositAmount: String(project.depositAmount ?? 0),
      bomLines: (project.bomLines ?? []).map((l: any) => ({
        ...l,
        plannedQty: String(l.plannedQty),
        scrapPct: String(l.scrapPct),
        consumedQty: String(l.consumedQty),
        reservedQty: String(l.reservedQty),
      })),
      materialIssues: (project.materialIssues ?? []).map((i: any) => ({
        ...i,
        quantity: String(i.quantity),
      })),
    };
  }

  async list(
    tenantSlug: string,
    opts: { status?: string; source?: string; from?: string; to?: string; take?: number },
  ) {
    await this.assertModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.ManufacturingProjectWhereInput = {};
    if (opts.source && opts.source !== 'ALL') {
      const src = opts.source.toUpperCase();
      if (!Object.values(ManufacturingProjectSource).includes(src as ManufacturingProjectSource)) {
        throw new BadRequestException('Origem inválida.');
      }
      where.source = src as ManufacturingProjectSource;
    }
    if (opts.status && opts.status !== 'ALL') {
      if (!Object.values(ManufacturingProjectStatus).includes(opts.status as ManufacturingProjectStatus)) {
        throw new BadRequestException('Status inválido.');
      }
      where.status = opts.status as ManufacturingProjectStatus;
    }
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = new Date(opts.from);
      if (opts.to) where.createdAt.lte = new Date(`${opts.to}T23:59:59.999Z`);
    }
    const rows = await db.manufacturingProject.findMany({
      where,
      include: PROJECT_INCLUDE,
      orderBy: { number: 'desc' },
      take: Math.min(opts.take ?? 200, 500),
    });
    return rows.map((r) => this.serialize(r));
  }

  async search(tenantSlug: string, q: string) {
    await this.assertModule(tenantSlug);
    const term = q.trim();
    if (term.length < 1) return [];
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const num = parseInt(term.replace(/\D/g, ''), 10);
    const rows = await db.manufacturingProject.findMany({
      where: {
        OR: [
          ...(Number.isFinite(num) ? [{ number: num }] : []),
          { customer: { name: { contains: term, mode: 'insensitive' } } },
          { title: { contains: term, mode: 'insensitive' } },
          { finishedVariant: { product: { name: { contains: term, mode: 'insensitive' } } } },
        ],
      },
      include: PROJECT_INCLUDE,
      take: 40,
      orderBy: { number: 'desc' },
    });
    return rows.map((r) => this.serialize(r));
  }

  private statusRank(status: ManufacturingProjectStatus): number {
    const ranks: Record<ManufacturingProjectStatus, number> = {
      [ManufacturingProjectStatus.PRODUCT_SELECTION]: 0,
      [ManufacturingProjectStatus.QUOTE]: 1,
      [ManufacturingProjectStatus.STARTED]: 2,
      [ManufacturingProjectStatus.IN_DEVELOPMENT]: 3,
      [ManufacturingProjectStatus.TESTING]: 4,
      [ManufacturingProjectStatus.FINISHED]: 5,
      [ManufacturingProjectStatus.CANCELLED]: -1,
    };
    return ranks[status] ?? 0;
  }

  /**
   * Corrige projetos “órfãos” (BOM não gerada na abertura, reservas/baixas não aplicadas).
   */
  private async reconcileProject(
    tenantSlug: string,
    projectId: string,
    userId: string | null,
    co: { factoryIssuePctAtStart: unknown; factoryIssuePctDevelopment: unknown },
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const project = await db.manufacturingProject.findUnique({
      where: { id: projectId },
      include: { bomLines: true },
    });
    if (!project || project.status === ManufacturingProjectStatus.CANCELLED) return;

    const histCount = await db.manufacturingStatusLog.count({ where: { projectId } });
    if (histCount === 0) {
      await db.manufacturingStatusLog.create({
        data: {
          projectId,
          fromStatus: null,
          toStatus: project.status,
          userId,
          note: 'Histórico reconstruído (projeto sem log de fases).',
        },
      });
    }

    let bomSynced = false;
    if (project.bomLines.length === 0) {
      try {
        await this.stock.syncBomFromRecipe(tenantSlug, projectId);
        bomSynced = true;
      } catch {
        /* PA sem ficha — usuário cadastra em Fichas técnicas */
      }
    }

    const rank = this.statusRank(project.status);
    if (rank >= this.statusRank(ManufacturingProjectStatus.STARTED)) {
      const activeRes = await db.manufacturingMaterialReservation.count({
        where: { projectId, active: true },
      });
      if (activeRes === 0) {
        try {
          await this.stock.createReservations(tenantSlug, projectId);
        } catch {
          /* estoque insuficiente — BOM visível; reserva falha com mensagem na transição */
        }
      }
    }

    const linesAfter =
      bomSynced
        ? await db.manufacturingBomLine.findMany({ where: { projectId } })
        : project.bomLines;
    const issueCount = await db.manufacturingMaterialIssue.count({ where: { projectId } });
    const needsStockCatchUp =
      linesAfter.length > 0 &&
      rank >= this.statusRank(ManufacturingProjectStatus.STARTED) &&
      (bomSynced ||
        (issueCount === 0 &&
          (Number(co.factoryIssuePctAtStart) > 0 ||
            Number(co.factoryIssuePctDevelopment) > 0 ||
            linesAfter.some((l) => l.issueAtStart))));

    if (needsStockCatchUp) {
      const uid = userId ?? 'system';
      if (rank >= this.statusRank(ManufacturingProjectStatus.STARTED)) {
        await this.stock.issueForPhaseTransition(
          tenantSlug,
          projectId,
          uid,
          ManufacturingProjectStatus.STARTED,
          Number(co.factoryIssuePctAtStart),
          Number(co.factoryIssuePctDevelopment),
        );
      }
      if (rank >= this.statusRank(ManufacturingProjectStatus.IN_DEVELOPMENT)) {
        await this.stock.issueForPhaseTransition(
          tenantSlug,
          projectId,
          uid,
          ManufacturingProjectStatus.IN_DEVELOPMENT,
          Number(co.factoryIssuePctAtStart),
          Number(co.factoryIssuePctDevelopment),
        );
      }
      if (rank >= this.statusRank(ManufacturingProjectStatus.TESTING)) {
        await this.stock.issueForPhaseTransition(
          tenantSlug,
          projectId,
          uid,
          ManufacturingProjectStatus.TESTING,
          Number(co.factoryIssuePctAtStart),
          Number(co.factoryIssuePctDevelopment),
        );
      }
    }
  }

  async detail(tenantSlug: string, id: string, userId?: string | null) {
    const co = await this.assertModule(tenantSlug);
    await this.reconcileProject(tenantSlug, id, userId ?? null, co);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.manufacturingProject.findUnique({
      where: { id },
      include: PROJECT_INCLUDE,
    });
    if (!row) throw new NotFoundException('Projeto não encontrado.');
    return this.serialize(row);
  }

  /** Projetos visíveis na agenda (intervalo inclusivo YYYY-MM-DD, horário local → UTC na borda). */
  async schedule(tenantSlug: string, from: string, to: string) {
    await this.assertModule(tenantSlug);
    const fromTrim = from?.trim();
    const toTrim = to?.trim();
    if (!fromTrim || !toTrim) {
      throw new BadRequestException('Informe from e to (YYYY-MM-DD).');
    }
    const rangeStart = new Date(`${fromTrim}T00:00:00.000`);
    const rangeEnd = new Date(`${toTrim}T23:59:59.999`);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      throw new BadRequestException('Datas from/to inválidas.');
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const rows = await db.manufacturingProject.findMany({
      where: {
        status: { not: ManufacturingProjectStatus.CANCELLED },
        OR: [
          { promisedAt: { gte: rangeStart, lte: rangeEnd } },
          {
            status: {
              notIn: [
                ManufacturingProjectStatus.FINISHED,
                ManufacturingProjectStatus.CANCELLED,
              ],
            },
            createdAt: { lte: rangeEnd },
          },
          { finishedAt: { gte: rangeStart, lte: rangeEnd } },
          {
            statusHistory: {
              some: { createdAt: { gte: rangeStart, lte: rangeEnd } },
            },
          },
        ],
      },
      include: {
        customer: { select: { id: true, name: true } },
        finishedVariant: {
          select: {
            id: true,
            sku: true,
            product: { select: { id: true, name: true, controlNumber: true } },
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          select: { fromStatus: true, toStatus: true, createdAt: true },
        },
      },
      orderBy: [{ promisedAt: 'asc' }, { number: 'desc' }],
      take: 500,
    });

    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      promisedAt: r.promisedAt,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      quantity: String(r.quantity),
      title: r.title,
      customer: r.customer,
      finishedVariant: r.finishedVariant,
      statusHistory: r.statusHistory
        .filter((h) => h.fromStatus == null || h.fromStatus !== h.toStatus)
        .map(({ toStatus, createdAt }) => ({ toStatus, createdAt })),
    }));
  }

  async create(
    tenantSlug: string,
    user: ActingUser,
    body: {
      customerId: string;
      finishedVariantId: string;
      quantity: number | string;
      title?: string | null;
      customerBrief?: string | null;
      technicalSpec?: string | null;
      promisedAt?: string | null;
      technicalResponsibleId?: string | null;
      commercialResponsibleId?: string | null;
      source?: string;
      externalRef?: string | null;
    },
  ) {
    await this.assertModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const qty = parseQty(body.quantity, 'Quantidade');
    const variant = await db.productVariant.findUnique({
      where: { id: body.finishedVariantId },
      include: { product: { select: { isManufacturedFinishedGood: true, name: true } } },
    });
    if (!variant) throw new BadRequestException('SKU do produto acabado inválido.');
    if (!variant.product.isManufacturedFinishedGood) {
      throw new BadRequestException('Produto não está marcado como PA fabricável.');
    }

    const sourceRaw = String(body.source ?? 'INTERNAL').toUpperCase();
    const source = Object.values(ManufacturingProjectSource).includes(
      sourceRaw as ManufacturingProjectSource,
    )
      ? (sourceRaw as ManufacturingProjectSource)
      : ManufacturingProjectSource.INTERNAL;

    const created = await db.manufacturingProject.create({
      data: {
        customerId: body.customerId,
        finishedVariantId: body.finishedVariantId,
        quantity: qty,
        title: body.title?.trim() || null,
        customerBrief: body.customerBrief?.trim() || null,
        technicalSpec: body.technicalSpec?.trim() || null,
        promisedAt: parsePromisedAtLocal(body.promisedAt),
        technicalResponsibleId: body.technicalResponsibleId || null,
        commercialResponsibleId: body.commercialResponsibleId || null,
        openedById: user.sub === 'public-lead' ? null : user.sub,
        source,
        externalRef: body.externalRef?.trim() || null,
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: ManufacturingProjectStatus.PRODUCT_SELECTION,
            userId: user.sub,
            note: 'Abertura',
          },
        },
      },
      include: PROJECT_INCLUDE,
    });

    try {
      await this.stock.syncBomFromRecipe(tenantSlug, created.id);
    } catch (e) {
      await db.manufacturingProject.delete({ where: { id: created.id } });
      throw e;
    }

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.CREATE,
      summary: `Abriu projeto de fabricação #${created.number}`,
      entityType: 'manufacturing_project',
      entityRef: created.id,
    });

    return this.serialize(await db.manufacturingProject.findUniqueOrThrow({
      where: { id: created.id },
      include: PROJECT_INCLUDE,
    }));
  }

  async update(
    tenantSlug: string,
    id: string,
    body: {
      title?: string | null;
      customerBrief?: string | null;
      technicalSpec?: string | null;
      deliveryNotes?: string | null;
      internalNotes?: string | null;
      qualityNotes?: string | null;
      promisedAt?: string | null;
      quoteTotal?: number | string | null;
      depositAmount?: number | string;
      technicalResponsibleId?: string | null;
      commercialResponsibleId?: string | null;
      quantity?: number | string;
    },
  ) {
    await this.assertModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const existing = await db.manufacturingProject.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Projeto não encontrado.');
    if (
      existing.status === ManufacturingProjectStatus.FINISHED ||
      existing.status === ManufacturingProjectStatus.CANCELLED
    ) {
      throw new BadRequestException('Projeto encerrado não pode ser alterado.');
    }

    const data: Prisma.ManufacturingProjectUpdateInput = {};
    const trim = (v: unknown) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const s = String(v).trim();
      return s.length ? s : null;
    };
    if (body.title !== undefined) data.title = trim(body.title);
    if (body.customerBrief !== undefined) data.customerBrief = trim(body.customerBrief);
    if (body.technicalSpec !== undefined) data.technicalSpec = trim(body.technicalSpec);
    if (body.deliveryNotes !== undefined) data.deliveryNotes = trim(body.deliveryNotes);
    if (body.internalNotes !== undefined) data.internalNotes = trim(body.internalNotes);
    if (body.qualityNotes !== undefined) data.qualityNotes = trim(body.qualityNotes);
    if (body.promisedAt !== undefined) {
      data.promisedAt = parsePromisedAtLocal(body.promisedAt);
    }
    if (body.quoteTotal !== undefined) {
      data.quoteTotal =
        body.quoteTotal == null || body.quoteTotal === ''
          ? null
          : parseQty(body.quoteTotal, 'Valor orçado');
    }
    if (body.depositAmount !== undefined) {
      data.depositAmount = parseQty(body.depositAmount, 'Sinal');
    }
    if (body.technicalResponsibleId !== undefined) {
      data.technicalResponsible = body.technicalResponsibleId
        ? { connect: { id: body.technicalResponsibleId } }
        : { disconnect: true };
    }
    if (body.commercialResponsibleId !== undefined) {
      data.commercialResponsible = body.commercialResponsibleId
        ? { connect: { id: body.commercialResponsibleId } }
        : { disconnect: true };
    }

    let recalcBom = false;
    if (body.quantity !== undefined) {
      data.quantity = parseQty(body.quantity, 'Quantidade');
      recalcBom = true;
    }

    await db.manufacturingProject.update({ where: { id }, data });
    if (recalcBom) await this.stock.syncBomFromRecipe(tenantSlug, id);

    return this.detail(tenantSlug, id);
  }

  async changeStatus(
    tenantSlug: string,
    user: ActingUser,
    id: string,
    toStatus: ManufacturingProjectStatus,
    note?: string | null,
  ) {
    const co = await this.assertModule(tenantSlug);
    await this.reconcileProject(tenantSlug, id, user.sub, co);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const project = await db.manufacturingProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    const from = project.status;
    if (from === toStatus) return this.detail(tenantSlug, id);
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(`Transição ${from} → ${toStatus} não permitida.`);
    }

    if (toStatus === ManufacturingProjectStatus.QUOTE) {
      await this.stock.syncBomFromRecipe(tenantSlug, id);
    }

    if (from === ManufacturingProjectStatus.QUOTE && toStatus === ManufacturingProjectStatus.STARTED) {
      await this.stock.syncBomFromRecipe(tenantSlug, id);
      await this.stock.createReservations(tenantSlug, id);
    }

    if (toStatus === ManufacturingProjectStatus.CANCELLED) {
      await this.stock.releaseReservations(tenantSlug, id);
    }

    const now = new Date();
    const patch: Prisma.ManufacturingProjectUpdateInput = { status: toStatus };
    if (toStatus === ManufacturingProjectStatus.QUOTE) patch.quotedAt = now;
    if (toStatus === ManufacturingProjectStatus.STARTED) {
      patch.startedAt = now;
      patch.approvedAt = patch.approvedAt ?? now;
    }
    if (toStatus === ManufacturingProjectStatus.FINISHED) patch.finishedAt = now;

    await db.$transaction([
      db.manufacturingProject.update({ where: { id }, data: patch }),
      db.manufacturingStatusLog.create({
        data: {
          projectId: id,
          fromStatus: from,
          toStatus,
          userId: user.sub,
          note: note?.trim() || null,
        },
      }),
    ]);

    if (
      toStatus === ManufacturingProjectStatus.STARTED ||
      toStatus === ManufacturingProjectStatus.IN_DEVELOPMENT ||
      toStatus === ManufacturingProjectStatus.TESTING
    ) {
      await this.stock.issueForPhaseTransition(
        tenantSlug,
        id,
        user.sub,
        toStatus,
        Number(co.factoryIssuePctAtStart),
        Number(co.factoryIssuePctDevelopment),
      );
    }

    if (toStatus === ManufacturingProjectStatus.FINISHED) {
      await this.stock.finishProject(tenantSlug, id, user.sub);
    }

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.UPDATE,
      summary: `Projeto fabricação #${project.number}: ${from} → ${toStatus}`,
      entityType: 'manufacturing_project',
      entityRef: id,
    });

    return this.detail(tenantSlug, id);
  }

  async listAssignees(tenantSlug: string) {
    await this.assertModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    return db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async recalculateBom(tenantSlug: string, id: string) {
    await this.assertModule(tenantSlug);
    await this.stock.syncBomFromRecipe(tenantSlug, id);
    return this.detail(tenantSlug, id);
  }

  /** Lead público — sem assertModule de empresa JWT; valida tenant + flag. */
  async createPublicLead(
    tenantSlug: string,
    body: {
      customerName: string;
      phone?: string | null;
      email?: string | null;
      finishedVariantId: string;
      quantity?: number | string;
      notes?: string | null;
      source?: string;
      externalRef?: string | null;
      title?: string | null;
    },
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const co = await db.company.findFirst();
    if (!co?.factoryModuleEnabled) {
      throw new ForbiddenException('Loja indisponível.');
    }

    const name = body.customerName.trim();
    if (name.length < 2) throw new BadRequestException('Informe seu nome.');

    const extRef = body.externalRef?.trim();
    if (extRef) {
      const existing = await db.manufacturingProject.findFirst({
        where: { externalRef: extRef },
        include: PROJECT_INCLUDE,
      });
      if (existing) return existing;
    }

    let customer = await db.customer.findFirst({
      where: body.phone
        ? { phone: { contains: body.phone.replace(/\D/g, '').slice(-8) } }
        : { name: { equals: name, mode: 'insensitive' } },
    });
    if (!customer) {
      customer = await db.customer.create({
        data: {
          name,
          phone: body.phone?.trim() || null,
          email: body.email?.trim() || null,
        },
      });
    }

    const sourceRaw = String(body.source ?? 'CATALOG').toUpperCase();
    const source = Object.values(ManufacturingProjectSource).includes(
      sourceRaw as ManufacturingProjectSource,
    )
      ? (sourceRaw as ManufacturingProjectSource)
      : ManufacturingProjectSource.CATALOG;

    return this.create(
      tenantSlug,
      { sub: 'public-lead', roles: ['admin'] },
      {
        customerId: customer.id,
        finishedVariantId: body.finishedVariantId,
        quantity: body.quantity ?? 1,
        customerBrief: body.notes?.trim() || null,
        title: body.title?.trim() || `Lead catálogo — ${name}`,
        source,
        externalRef: body.externalRef?.trim() || null,
      },
    );
  }

  async publicCatalog(tenantSlug: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const co = await db.company.findFirst();
    if (!co?.factoryModuleEnabled) {
      throw new ForbiddenException('Catálogo indisponível.');
    }
    const products = await db.product.findMany({
      where: { isActive: true, showInPublicCatalog: true, isManufacturedFinishedGood: true },
      include: {
        variants: { orderBy: { sku: 'asc' }, take: 1 },
        category: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return {
      company: {
        tradeName: co.tradeName,
        phone: co.phone,
        city: co.city,
        state: co.state,
      },
      catalogSettings: {
        whatsappMessageTemplate: co.factoryCatalogWhatsappMessageTemplate?.trim() || null,
      },
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        controlNumber: p.controlNumber,
        category: p.category?.name ?? null,
        leadTimeDays: p.manufacturingLeadTimeDays,
        imageVersion: p.imageVersion,
        hasImage: p.hasImage,
        variant: p.variants[0]
          ? {
              id: p.variants[0].id,
              sku: p.variants[0].sku,
              retailPrice: String(p.variants[0].retailPrice),
            }
          : null,
      })),
    };
  }

  async updateBomLine(
    tenantSlug: string,
    projectId: string,
    lineId: string,
    body: { scrapPct?: number | string; issueAtStart?: boolean },
  ) {
    await this.assertModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const project = await db.manufacturingProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    if (
      project.status === ManufacturingProjectStatus.FINISHED ||
      project.status === ManufacturingProjectStatus.CANCELLED
    ) {
      throw new BadRequestException('Projeto encerrado.');
    }
    const line = await db.manufacturingBomLine.findFirst({
      where: { id: lineId, projectId },
    });
    if (!line) throw new NotFoundException('Linha BOM não encontrada.');
    const data: Prisma.ManufacturingBomLineUpdateInput = {};
    if (body.scrapPct !== undefined) {
      const n = parseFloat(String(body.scrapPct).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new BadRequestException('Scrap % inválido (0–100).');
      }
      data.scrapPct = n;
    }
    if (body.issueAtStart !== undefined) {
      data.issueAtStart = Boolean(body.issueAtStart);
    }
    await db.manufacturingBomLine.update({ where: { id: lineId }, data });
    return this.detail(tenantSlug, projectId);
  }

  async addApontamento(
    tenantSlug: string,
    user: ActingUser,
    projectId: string,
    note: string,
  ) {
    await this.assertModule(tenantSlug);
    const text = note?.trim();
    if (!text) throw new BadRequestException('Informe o texto do apontamento.');
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const project = await db.manufacturingProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    if (
      project.status === ManufacturingProjectStatus.FINISHED ||
      project.status === ManufacturingProjectStatus.CANCELLED
    ) {
      throw new BadRequestException('Projeto encerrado.');
    }
    await db.manufacturingStatusLog.create({
      data: {
        projectId,
        fromStatus: project.status,
        toStatus: project.status,
        userId: user.sub,
        note: text,
      },
    });
    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.UPDATE,
      summary: `Projeto fabricação #${project.number}: apontamento`,
      entityType: 'manufacturing_project',
      entityRef: projectId,
    });
    return this.detail(tenantSlug, projectId);
  }

  async addAdditionalBom(
    tenantSlug: string,
    user: ActingUser,
    projectId: string,
    body: {
      ingredientVariantId: string;
      quantity: number | string;
      reason?: string | null;
      issueNow?: boolean;
    },
  ) {
    await this.assertModule(tenantSlug);
    const qty = parseQty(body.quantity, 'Quantidade adicional');
    await this.stock.addAdditionalPlannedQty(tenantSlug, projectId, user.sub, {
      ingredientVariantId: body.ingredientVariantId,
      quantity: qty,
      reason: body.reason,
      issueNow: Boolean(body.issueNow),
    });
    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.UPDATE,
      summary: `Projeto fabricação: insumo adicional na BOM`,
      entityType: 'manufacturing_project',
      entityRef: projectId,
    });
    return this.detail(tenantSlug, projectId);
  }

  async linkDepositSale(tenantSlug: string, projectId: string, saleId: string) {
    await this.assertModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const project = await db.manufacturingProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    const sale = await db.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    if (sale.customerId !== project.customerId) {
      throw new BadRequestException('A venda deve ser do mesmo cliente do projeto.');
    }
    const existing = await db.manufacturingProject.findFirst({
      where: { depositSaleId: saleId, id: { not: projectId } },
    });
    if (existing) {
      throw new BadRequestException(`Venda já vinculada ao projeto #${existing.number}.`);
    }
    await db.manufacturingProject.update({
      where: { id: projectId },
      data: {
        depositSaleId: saleId,
        depositAmount: sale.total,
      },
    });
    return this.detail(tenantSlug, projectId);
  }

  async printData(tenantSlug: string, id: string) {
    const co = await this.assertModule(tenantSlug);
    const project = await this.detail(tenantSlug, id);
    return {
      company: {
        legalName: co.legalName,
        tradeName: co.tradeName,
        cnpj: co.cnpj,
        phone: co.phone,
        address: co.address,
        city: co.city,
        state: co.state,
        termsText: co.factoryQuoteTermsText,
      },
      project,
    };
  }

  async operationalAlerts(tenantSlug: string) {
    await this.assertModule(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const activeStatuses: ManufacturingProjectStatus[] = [
      ManufacturingProjectStatus.PRODUCT_SELECTION,
      ManufacturingProjectStatus.QUOTE,
      ManufacturingProjectStatus.STARTED,
      ManufacturingProjectStatus.IN_DEVELOPMENT,
      ManufacturingProjectStatus.TESTING,
    ];
    const overdue = await db.manufacturingProject.findMany({
      where: {
        status: { in: activeStatuses },
        promisedAt: { lt: todayStart },
      },
      select: {
        id: true,
        number: true,
        promisedAt: true,
        status: true,
        customer: { select: { name: true } },
      },
      orderBy: { promisedAt: 'asc' },
      take: 50,
    });
    const active = await db.manufacturingProject.findMany({
      where: { status: { in: activeStatuses } },
      include: {
        bomLines: {
          include: {
            ingredientVariant: {
              select: { id: true, sku: true, product: { select: { name: true } } },
            },
          },
        },
      },
      take: 100,
    });
    const needByVariant = new Map<
      string,
      { variantId: string; sku: string; name: string; need: number }
    >();
    for (const p of active) {
      for (const line of p.bomLines) {
        const planned = Number(line.plannedQty) * (1 + Number(line.scrapPct) / 100);
        const remaining = Math.max(0, planned - Number(line.consumedQty));
        if (remaining <= 0) continue;
        const vid = line.ingredientVariantId;
        const cur = needByVariant.get(vid);
        if (cur) cur.need += remaining;
        else {
          needByVariant.set(vid, {
            variantId: vid,
            sku: line.ingredientVariant.sku,
            name: line.ingredientVariant.product.name,
            need: remaining,
          });
        }
      }
    }
    const shortages: Array<{
      variantId: string;
      sku: string;
      name: string;
      need: number;
      available: number;
      gap: number;
    }> = [];
    for (const row of needByVariant.values()) {
      const available = await this.stock.availableQty(db, row.variantId);
      const gap = row.need - available;
      if (gap > 0.0001) {
        shortages.push({
          variantId: row.variantId,
          sku: row.sku,
          name: row.name,
          need: Math.round(row.need * 10000) / 10000,
          available,
          gap: Math.round(gap * 10000) / 10000,
        });
      }
    }
    shortages.sort((a, b) => b.gap - a.gap);
    return {
      overdueCount: overdue.length,
      overdue,
      materialShortageCount: shortages.length,
      materialShortages: shortages.slice(0, 30),
    };
  }

  async mrpSuggestions(tenantSlug: string) {
    await this.assertModule(tenantSlug);
    const alerts = await this.operationalAlerts(tenantSlug);
    return {
      generatedAt: new Date().toISOString(),
      suggestions: alerts.materialShortages.map((s) => ({
        ingredientVariantId: s.variantId,
        sku: s.sku,
        productName: s.name,
        suggestedPurchaseQty: s.gap,
        reason: 'Demanda agregada de projetos ativos menos disponível (ATP).',
      })),
    };
  }

  private static readonly MFG_ACTIVE: ManufacturingProjectStatus[] = [
    ManufacturingProjectStatus.PRODUCT_SELECTION,
    ManufacturingProjectStatus.QUOTE,
    ManufacturingProjectStatus.STARTED,
    ManufacturingProjectStatus.IN_DEVELOPMENT,
    ManufacturingProjectStatus.TESTING,
  ];

  private classifyDelivery(
    status: ManufacturingProjectStatus,
    promisedAt: Date | null,
    finishedAt: Date | null,
    todayStart: Date,
  ):
    | 'no_promise'
    | 'on_track'
    | 'overdue'
    | 'delivered_on_time'
    | 'delivered_late'
    | 'cancelled' {
    if (status === ManufacturingProjectStatus.CANCELLED) return 'cancelled';
    if (!promisedAt) return 'no_promise';
    if (status === ManufacturingProjectStatus.FINISHED) {
      if (!finishedAt) return 'delivered_on_time';
      const deadline = endOfDay(promisedAt);
      return finishedAt.getTime() <= deadline.getTime() ? 'delivered_on_time' : 'delivered_late';
    }
    if (ManufacturingService.MFG_ACTIVE.includes(status)) {
      return promisedAt.getTime() < todayStart.getTime() ? 'overdue' : 'on_track';
    }
    return 'no_promise';
  }

  async projectReports(
    tenantSlug: string,
    opts: {
      report: string;
      dateField: string;
      from?: string;
      to?: string;
      customerId?: string;
    },
  ) {
    await this.assertModule(tenantSlug);
    const report = opts.report.trim().toLowerCase();
    const allowedReports = ['on_time', 'overdue', 'top_price', 'low_price', 'by_customer'] as const;
    if (!allowedReports.includes(report as (typeof allowedReports)[number])) {
      throw new BadRequestException(
        'Relatório inválido. Use: on_time, overdue, top_price, low_price, by_customer.',
      );
    }

    const dateField = opts.dateField.trim();
    const allowedFields = ['createdAt', 'promisedAt', 'quotedAt', 'finishedAt', 'approvedAt'] as const;
    if (!allowedFields.includes(dateField as (typeof allowedFields)[number])) {
      throw new BadRequestException('Campo de data inválido.');
    }

    const now = new Date();
    const defFrom = formatLocalDateISO(new Date(now.getFullYear(), 0, 1));
    const defTo = formatLocalDateISO(now);
    const fromStr = opts.from?.trim() || defFrom;
    const toStr = opts.to?.trim() || defTo;
    const rangeStart = parseQueryDate(fromStr, 'start');
    const rangeEnd = parseQueryDate(toStr, 'end');
    if (rangeStart.getTime() > rangeEnd.getTime()) {
      throw new BadRequestException('Data inicial não pode ser posterior à final.');
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const todayStart = startOfDay(new Date());

    const inRange = { gte: rangeStart, lte: rangeEnd };
    const dateWhere: Prisma.ManufacturingProjectWhereInput =
      dateField === 'createdAt'
        ? { createdAt: inRange }
        : {
            OR: [
              { [dateField]: inRange },
              { [dateField]: null, createdAt: inRange },
              { createdAt: inRange },
            ],
          };

    const andParts: Prisma.ManufacturingProjectWhereInput[] = [dateWhere];
    if (report !== 'by_customer') {
      andParts.unshift({ status: { not: ManufacturingProjectStatus.CANCELLED } });
    }
    if (opts.customerId?.trim()) {
      andParts.push({ customerId: opts.customerId.trim() });
    }
    const where: Prisma.ManufacturingProjectWhereInput = { AND: andParts };

    const rows = await db.manufacturingProject.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        finishedVariant: {
          select: {
            sku: true,
            product: { select: { name: true, controlNumber: true } },
          },
        },
      },
      take: 1500,
      orderBy: { number: 'desc' },
    });

    type Situation = ReturnType<ManufacturingService['classifyDelivery']>;
    const enriched = rows.map((p) => {
      const deliverySituation = this.classifyDelivery(
        p.status,
        p.promisedAt,
        p.finishedAt,
        todayStart,
      );
      return {
        id: p.id,
        number: p.number,
        status: p.status,
        title: p.title,
        promisedAt: p.promisedAt,
        quoteTotal: p.quoteTotal != null ? Number(p.quoteTotal) : null,
        quoteTotalStr: p.quoteTotal != null ? String(p.quoteTotal) : null,
        createdAt: p.createdAt,
        finishedAt: p.finishedAt,
        quotedAt: p.quotedAt,
        customer: p.customer,
        finishedVariant: p.finishedVariant,
        deliverySituation,
      };
    });

    const onTimeSet = new Set<Situation>(['on_track', 'delivered_on_time', 'no_promise']);
    const overdueSet = new Set<Situation>(['overdue', 'delivered_late']);

    let filtered = enriched;
    if (report === 'on_time') {
      filtered = enriched.filter((r) => onTimeSet.has(r.deliverySituation));
    } else if (report === 'overdue') {
      filtered = enriched.filter((r) => overdueSet.has(r.deliverySituation));
    } else if (report === 'top_price') {
      filtered = [...enriched].sort((a, b) => (b.quoteTotal ?? 0) - (a.quoteTotal ?? 0));
    } else if (report === 'low_price') {
      filtered = [...enriched].sort((a, b) => (a.quoteTotal ?? 0) - (b.quoteTotal ?? 0));
    }

    const dateFieldLabels: Record<string, string> = {
      createdAt: 'Abertura do projeto',
      promisedAt: 'Promessa de entrega',
      quotedAt: 'Orçamento',
      finishedAt: 'Conclusão',
      approvedAt: 'Aprovação',
    };

    const reportLabels: Record<string, string> = {
      on_time: 'Projetos dentro do prazo',
      overdue: 'Projetos atrasados',
      top_price: 'Maior valor de orçamento',
      low_price: 'Menor valor de orçamento',
      by_customer: 'Resumo por cliente',
    };

    if (report === 'by_customer') {
      const map = new Map<
        string,
        {
          customerId: string;
          customerName: string;
          projectCount: number;
          quotedTotal: number;
          onTimeCount: number;
          overdueCount: number;
        }
      >();
      for (const r of enriched) {
        const cur = map.get(r.customer.id) ?? {
          customerId: r.customer.id,
          customerName: r.customer.name,
          projectCount: 0,
          quotedTotal: 0,
          onTimeCount: 0,
          overdueCount: 0,
        };
        cur.projectCount += 1;
        if (r.quoteTotal != null) cur.quotedTotal += r.quoteTotal;
        if (onTimeSet.has(r.deliverySituation)) cur.onTimeCount += 1;
        if (overdueSet.has(r.deliverySituation)) cur.overdueCount += 1;
        map.set(r.customer.id, cur);
      }
      const groups = [...map.values()].sort(
        (a, b) => b.quotedTotal - a.quotedTotal || b.projectCount - a.projectCount,
      );
      return {
        report,
        reportLabel: reportLabels[report],
        period: {
          from: fromStr,
          to: toStr,
          dateField,
          dateFieldLabel: dateFieldLabels[dateField] ?? dateField,
        },
        summary: {
          projectCount: enriched.length,
          truncated: rows.length >= 1500,
          quotedTotal: enriched.reduce((s, r) => s + (r.quoteTotal ?? 0), 0),
          customerCount: groups.length,
        },
        groups: groups.map((g) => ({
          ...g,
          quotedTotal: Math.round(g.quotedTotal * 100) / 100,
        })),
        rows: [],
      };
    }

    const listRows = filtered.slice(0, 500).map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      title: r.title,
      promisedAt: r.promisedAt,
      quoteTotal: r.quoteTotalStr,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      quotedAt: r.quotedAt,
      customer: r.customer,
      finishedVariant: r.finishedVariant,
      deliverySituation: r.deliverySituation,
    }));

    return {
      report,
      reportLabel: reportLabels[report],
      period: {
        from: fromStr,
        to: toStr,
        dateField,
        dateFieldLabel: dateFieldLabels[dateField] ?? dateField,
      },
      summary: {
        projectCount: listRows.length,
        totalInPeriod: enriched.length,
        truncated: rows.length >= 1500,
        quotedTotal: listRows.reduce((s, r) => s + Number(r.quoteTotal ?? 0), 0),
      },
      groups: [],
      rows: listRows,
    };
  }
}
