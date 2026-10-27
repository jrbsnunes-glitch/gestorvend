import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FiscalDocumentKind,
  FiscalDocumentStatus,
  PaymentMethod,
  SaleSource,
  SaleStatus,
} from '../generated/tenant-client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SalesService } from '../sales/sales.service';
import { FiscalEmissionProcessorService } from './fiscal-emission.processor';
import { FiscalDocumentsService } from './fiscal-documents.service';
import type { ManualNfeInput } from './manual-nfe.types';

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

type TenantDb = Awaited<ReturnType<TenantPrismaService['getClient']>>;

@Injectable()
export class FiscalManualNfeService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sales: SalesService,
    private readonly emission: FiscalEmissionProcessorService,
    private readonly docs: FiscalDocumentsService,
  ) {}

  private validateInput(input: ManualNfeInput): void {
    if (!input.customerId?.trim()) {
      throw new BadRequestException('Selecione o destinatário (cliente).');
    }
    if (!input.operationNatureId?.trim()) {
      throw new BadRequestException('Informe a natureza da operação.');
    }
    if (!input.items?.length) {
      throw new BadRequestException('Informe ao menos um item na NF-e.');
    }
    if (!input.payments?.length) {
      throw new BadRequestException('Informe ao menos uma forma de pagamento.');
    }
  }

  private lineTotals(input: ManualNfeInput) {
    let subtotal = 0;
    const lines: Array<{
      variantId: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      totalLine: number;
    }> = [];
    for (const it of input.items) {
      const q = Number(it.quantity);
      const p = Number(it.unitPrice);
      const d = Number(it.discount ?? 0);
      if (q <= 0) throw new BadRequestException('Quantidade inválida.');
      const gross = roundMoney2(q * p);
      if (d > gross + 0.009) {
        throw new BadRequestException('Desconto de item não pode exceder o valor da linha.');
      }
      const totalLine = roundMoney2(gross - d);
      subtotal += totalLine;
      lines.push({
        variantId: it.variantId,
        quantity: q,
        unitPrice: p,
        discount: d,
        totalLine,
      });
    }
    subtotal = roundMoney2(subtotal);
    const discount = roundMoney2(Number(input.discount ?? 0));
    const surcharge = roundMoney2(Number(input.surcharge ?? 0));
    const freightMod = Number(input.freightMod ?? 9);
    const freight =
      freightMod === 9 ? 0 : roundMoney2(Number(input.freightAmount ?? 0));
    const total = roundMoney2(Math.max(0, subtotal - discount + surcharge + freight));
    return { subtotal, discount, surcharge, freight, freightMod, total, lines };
  }

  async createManualNfe(user: JwtPayload, input: ManualNfeInput) {
    this.validateInput(input);
    const { total } = this.lineTotals(input);
    if (total <= 0) {
      throw new BadRequestException('Total da NF-e deve ser maior que zero.');
    }

    const sale = await this.sales.create({
      tenantSlug: user.tenantSlug,
      userId: user.sub,
      userRoles: user.roles ?? [],
      customerId: input.customerId,
      notes: input.notes ?? null,
      discount: input.discount ?? 0,
      surcharge: input.surcharge ?? 0,
      freightAmount: input.freightAmount ?? 0,
      freightMod: input.freightMod ?? 9,
      operationNatureId: input.operationNatureId,
      deliveryVehiclePlate: input.deliveryVehiclePlate ?? null,
      deliveryDriverName: input.deliveryDriverName ?? null,
      deductStock: input.deductStock !== false,
      source: SaleSource.NFE_FORM,
      items: input.items.map((it) => ({
        variantId: it.variantId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount ?? 0,
      })),
      payments: input.payments.map((p) => ({
        method: p.method as PaymentMethod,
        amount: p.amount,
      })),
    });

    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const doc = await db.fiscalDocument.create({
      data: {
        saleId: sale.id,
        kind: FiscalDocumentKind.NF_E,
        status: FiscalDocumentStatus.DRAFT,
        tpEmis: 1,
      },
    });

    if (input.emitNow === true) {
      const sent = await this.sendDraftDocument(user.tenantSlug, doc.id);
      return { sale, document: sent };
    }
    return { sale, document: doc };
  }

  async updateManualNfe(user: JwtPayload, docId: string, input: ManualNfeInput) {
    this.validateInput(input);
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const doc = await this.loadEditableManualDoc(db, docId);
    const totals = this.lineTotals(input);
    if (totals.total <= 0) {
      throw new BadRequestException('Total da NF-e deve ser maior que zero.');
    }

    await db.$transaction(async (tx) => {
      await tx.saleItem.deleteMany({ where: { saleId: doc.saleId } });
      await tx.salePayment.deleteMany({ where: { saleId: doc.saleId } });
      await tx.sale.update({
        where: { id: doc.saleId },
        data: {
          customerId: input.customerId,
          notes: input.notes ?? null,
          discount: totals.discount,
          surcharge: totals.surcharge,
          freightAmount: totals.freight,
          freightMod: totals.freightMod,
          operationNatureId: input.operationNatureId,
          deliveryVehiclePlate: input.deliveryVehiclePlate ?? null,
          deliveryDriverName: input.deliveryDriverName ?? null,
          deductStock: input.deductStock !== false,
          subtotal: totals.subtotal,
          total: totals.total,
          status: SaleStatus.COMPLETED,
          items: {
            create: totals.lines.map((l) => ({
              variantId: l.variantId,
              quantity: String(l.quantity),
              unitPrice: String(l.unitPrice),
              discount: String(l.discount),
              totalLine: String(l.totalLine),
            })),
          },
          payments: {
            create: input.payments.map((p) => ({
              method: p.method as PaymentMethod,
              amount: String(roundMoney2(Number(p.amount))),
            })),
          },
        },
      });
      await tx.fiscalDocument.update({
        where: { id: docId },
        data: {
          status: FiscalDocumentStatus.DRAFT,
          lastError: null,
          accessKey: null,
          protocol: null,
          xmlPath: null,
          xmlSha256: null,
        },
      });
    });

    return this.docs.getById(user.tenantSlug, docId);
  }

  async getManualNfeDraft(tenantSlug: string, docId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await this.loadEditableManualDoc(db, docId);
    const detail = await this.docs.getById(tenantSlug, docId);
    return { ...detail, documentId: doc.id };
  }

  async previewManualNfe(tenantSlug: string, input: ManualNfeInput) {
    this.validateInput(input);
    const totals = this.lineTotals(input);
    if (totals.total <= 0) {
      throw new BadRequestException('Total da NF-e deve ser maior que zero.');
    }
    return this.docs.buildManualNfePreviewPayload(tenantSlug, input, totals.total);
  }

  async sendDraftDocument(tenantSlug: string, docId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.fiscalDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('Documento fiscal não encontrado.');
    if (
      doc.status === FiscalDocumentStatus.AUTHORIZED ||
      doc.status === FiscalDocumentStatus.CANCELLED
    ) {
      throw new BadRequestException('Esta nota já foi concluída e não pode ser reenviada.');
    }
    // SENT sem retorno (ou com rejeição) precisa poder reenviar — senão o botão some.

    const alreadyProcessable =
      doc.status === FiscalDocumentStatus.QUEUED ||
      doc.status === FiscalDocumentStatus.CONTINGENCY;

    if (!alreadyProcessable) {
      await db.fiscalDocument.update({
        where: { id: docId },
        data: {
          status: FiscalDocumentStatus.QUEUED,
          lastError: null,
          nextAttemptAt: new Date(),
        },
      });
    }

    try {
      await this.emission.processDocumentNow(tenantSlug, docId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.fiscalDocument.update({
        where: { id: docId },
        data: {
          status: FiscalDocumentStatus.ERROR,
          lastError: msg.slice(0, 2000),
        },
      });
      throw new BadRequestException(msg);
    }

    return this.docs.getById(tenantSlug, docId);
  }

  /**
   * Envia várias notas agora (SEFAZ). Usado para contingência em lote ou seleção.
   * Processa no máximo 15 por chamada; o restante fica na fila do worker.
   */
  async sendBatch(
    tenantSlug: string,
    opts: {
      ids?: string[];
      contingencyOnly?: boolean;
      kind?: FiscalDocumentKind;
      dateFrom?: string | null;
      dateTo?: string | null;
      controlMin?: number | null;
      controlMax?: number | null;
    },
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const ids = await this.resolveBatchIds(db, opts);
    if (ids.length === 0) {
      throw new BadRequestException(
        opts.contingencyOnly
          ? 'Nenhuma nota em contingência neste filtro.'
          : 'Selecione ao menos uma nota para enviar.',
      );
    }

    const nowIds = ids.slice(0, 15);
    const queuedIds = ids.slice(15);
    if (queuedIds.length > 0) {
      await db.fiscalDocument.updateMany({
        where: {
          id: { in: queuedIds },
          status: { notIn: [FiscalDocumentStatus.AUTHORIZED, FiscalDocumentStatus.CANCELLED] },
        },
        data: { status: FiscalDocumentStatus.QUEUED, nextAttemptAt: new Date() },
      });
    }

    const results: Array<{
      id: string;
      ok: boolean;
      status?: string;
      lastError?: string | null;
      error?: string;
    }> = [];

    for (const id of nowIds) {
      try {
        const doc = await this.sendDraftDocument(tenantSlug, id);
        results.push({
          id,
          ok: doc.status === FiscalDocumentStatus.AUTHORIZED,
          status: doc.status,
          lastError: doc.lastError,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ id, ok: false, error: msg.slice(0, 400) });
      }
    }

    const authorized = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    return {
      total: ids.length,
      processedNow: nowIds.length,
      queuedForWorker: queuedIds.length,
      authorized,
      failed,
      results,
    };
  }

  private async resolveBatchIds(
    db: TenantDb,
    opts: {
      ids?: string[];
      contingencyOnly?: boolean;
      kind?: FiscalDocumentKind;
      dateFrom?: string | null;
      dateTo?: string | null;
      controlMin?: number | null;
      controlMax?: number | null;
    },
  ): Promise<string[]> {
    const requested = [...new Set((opts.ids ?? []).map((id) => id.trim()).filter(Boolean))];
    if (requested.length > 0 && !opts.contingencyOnly) {
      return requested.slice(0, 40);
    }

    const saleWhere: {
      createdAt?: { gte?: Date; lte?: Date };
      number?: { gte?: number; lte?: number };
    } = {};
    if (opts.dateFrom || opts.dateTo) {
      saleWhere.createdAt = {};
      if (opts.dateFrom) {
        const d = new Date(opts.dateFrom);
        if (!Number.isNaN(d.getTime())) saleWhere.createdAt.gte = d;
      }
      if (opts.dateTo) {
        const d = new Date(opts.dateTo);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          saleWhere.createdAt.lte = d;
        }
      }
    }
    if (opts.controlMin != null || opts.controlMax != null) {
      saleWhere.number = {};
      if (opts.controlMin != null && Number.isFinite(opts.controlMin)) {
        saleWhere.number.gte = Math.trunc(opts.controlMin);
      }
      if (opts.controlMax != null && Number.isFinite(opts.controlMax)) {
        saleWhere.number.lte = Math.trunc(opts.controlMax);
      }
    }

    const rows = await db.fiscalDocument.findMany({
      where: {
        ...(opts.kind ? { kind: opts.kind } : {}),
        status: opts.contingencyOnly
          ? FiscalDocumentStatus.CONTINGENCY
          : {
              in: [
                FiscalDocumentStatus.DRAFT,
                FiscalDocumentStatus.QUEUED,
                FiscalDocumentStatus.ERROR,
                FiscalDocumentStatus.REJECTED,
                FiscalDocumentStatus.BUILDING_XML,
                FiscalDocumentStatus.CONTINGENCY,
                FiscalDocumentStatus.SENT,
              ],
            },
        ...(requested.length > 0 ? { id: { in: requested } } : {}),
        sale: saleWhere,
      },
      orderBy: { createdAt: 'asc' },
      take: 40,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async loadEditableManualDoc(db: TenantDb, docId: string) {
    const doc = await db.fiscalDocument.findUnique({
      where: { id: docId },
      include: { sale: { select: { id: true, source: true } } },
    });
    if (!doc) throw new NotFoundException('Documento fiscal não encontrado.');
    if (doc.kind !== FiscalDocumentKind.NF_E) {
      throw new BadRequestException('Somente NF-e manual pode ser editada aqui.');
    }
    if (doc.sale?.source !== SaleSource.NFE_FORM) {
      throw new BadRequestException('Documento não é de formulário NF-e.');
    }
    const editable: FiscalDocumentStatus[] = [
      FiscalDocumentStatus.DRAFT,
      FiscalDocumentStatus.REJECTED,
      FiscalDocumentStatus.ERROR,
    ];
    if (!editable.includes(doc.status)) {
      throw new BadRequestException('Nota já enviada/autorizada — não pode ser editada.');
    }
    return doc;
  }
}
