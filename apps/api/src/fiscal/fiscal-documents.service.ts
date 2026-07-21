import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FiscalDocumentKind,
  FiscalDocumentStatus,
  FiscalSefazEnvironment,
  PdvDocumentMode,
  Prisma,
  SaleStatus,
  UserPermissionCode,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UserPermissionsService } from '../users/user-permissions.service';
import { FiscalIssuerSettingsService } from './fiscal-issuer-settings.service';
import { createMutualTlsAgentFromPfx, loadPfxMaterial } from './issuer/load-pfx';
import { extractCnpjFromPfx } from './issuer/cert-cnpj';
import { validateCnpj14, digitsCnpj } from '../common/cnpj.util';
import { ufToCodIbge } from './utils/uf-ibge';
import { postCancelamentoNfe } from './sefaz/nfe-cancelamento.soap';
import {
  buildInutilizacaoXml,
  inutilizacaoEndpoint,
  parseInutilizacaoResponse,
  postInutilizacao,
} from './sefaz/nfe-inutilizacao.soap';

export type FiscalDocumentListQuery = {
  kind?: FiscalDocumentKind;
  dateFrom?: string | null;
  dateTo?: string | null;
  controlMin?: number | null;
  controlMax?: number | null;
  customerId?: string | null;
  customerSegment?: string | null;
  /** Se true, restringe a AUTHORIZED (combinável com contingency via OR). */
  authorized?: boolean;
  /** Se true, restringe a CONTINGENCY. */
  contingency?: boolean;
  take?: number;
  skip?: number;
};

/**
 * Fila local de emissão por venda (próximo passo: worker com XML, certificado A1, SEFAZ).
 */
@Injectable()
export class FiscalDocumentsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly userPermissions: UserPermissionsService,
    private readonly config: ConfigService,
    private readonly issuerSvc: FiscalIssuerSettingsService,
  ) {}

  async queue(tenantSlug: string, saleId: string, kind: FiscalDocumentKind) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!company) {
      throw new BadRequestException('Empresa não configurada');
    }
    if (company.pdvDocumentMode !== PdvDocumentMode.ELECTRONIC_FISCAL_PLANNED) {
      throw new BadRequestException(
        'A empresa está em modo comprovante não fiscal. Em Cadastro da empresa, selecione documento fiscal planejado antes de enfileirar.',
      );
    }
    const sale = await db.sale.findUnique({ where: { id: saleId } });
    if (!sale) {
      throw new NotFoundException('Venda não encontrada');
    }
    if (sale.status !== SaleStatus.COMPLETED) {
      throw new BadRequestException('Só é possível enfileirar documento para venda concluída.');
    }
    return db.fiscalDocument.upsert({
      where: { saleId },
      create: {
        saleId,
        kind,
        status: FiscalDocumentStatus.QUEUED,
        lastError: null,
        nextAttemptAt: new Date(),
        tpEmis: 1,
      },
      update: {
        kind,
        status: FiscalDocumentStatus.QUEUED,
        lastError: null,
        nextAttemptAt: new Date(),
        accessKey: null,
        protocol: null,
        sefazEnvironment: null,
        tpEmis: 1,
        xmlPath: null,
        xmlSha256: null,
      },
    });
  }

  /**
   * Marca documento como contingência (pendente de envio à SEFAZ).
   * Usado quando a emissão online falha ou o operador emite offline.
   */
  async markContingency(tenantSlug: string, documentId: string, tpEmis = 9) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.fiscalDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Documento fiscal não encontrado.');
    if (doc.status === FiscalDocumentStatus.AUTHORIZED) {
      throw new BadRequestException('Documento já autorizado — não pode ir para contingência.');
    }
    if (doc.status === FiscalDocumentStatus.CANCELLED) {
      throw new BadRequestException('Documento cancelado.');
    }
    return db.fiscalDocument.update({
      where: { id: documentId },
      data: {
        status: FiscalDocumentStatus.CONTINGENCY,
        tpEmis: Math.max(2, Math.min(9, tpEmis | 0)) || 9,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
  }

  /** Reenfileira contingência para tentativa de envio (mantém tpEmis/chave/XML). */
  async queueContingencySend(tenantSlug: string, documentId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.fiscalDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Documento fiscal não encontrado.');
    if (doc.status !== FiscalDocumentStatus.CONTINGENCY) {
      throw new BadRequestException('Somente documentos em contingência podem ser reenviados assim.');
    }
    return db.fiscalDocument.update({
      where: { id: documentId },
      data: {
        status: FiscalDocumentStatus.QUEUED,
        nextAttemptAt: new Date(),
        lastError: null,
        // Mantém tpEmis, accessKey e xmlPath para retransmitir a mesma nota.
      },
    });
  }

  async findBySaleId(tenantSlug: string, saleId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await db.sale.findUnique({ where: { id: saleId }, select: { id: true } });
    if (!sale) {
      throw new NotFoundException('Venda não encontrada');
    }
    return db.fiscalDocument.findUnique({ where: { saleId } });
  }

  async getById(tenantSlug: string, id: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.fiscalDocument.findUnique({
      where: { id },
      include: {
        sale: {
          include: {
            customer: { select: { id: true, name: true, document: true, segment: true } },
            items: {
              include: {
                variant: {
                  include: {
                    product: {
                      select: {
                        id: true,
                        name: true,
                        category: { select: { id: true, name: true } },
                        fiscalSituation: {
                          select: { cfopInternal: true, cfopInterstate: true, code: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            payments: true,
          },
        },
      },
    });
    if (!doc) throw new NotFoundException('Documento fiscal não encontrado.');
    return this.mapListItem(doc);
  }

  async list(tenantSlug: string, q: FiscalDocumentListQuery) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const take = Math.min(500, Math.max(1, q.take ?? 30));
    const skip = Math.max(0, q.skip ?? 0);

    const saleWhere: Prisma.SaleWhereInput = {};
    if (q.dateFrom || q.dateTo) {
      saleWhere.createdAt = {};
      if (q.dateFrom) {
        const d = new Date(q.dateFrom);
        if (!Number.isNaN(d.getTime())) saleWhere.createdAt.gte = d;
      }
      if (q.dateTo) {
        const d = new Date(q.dateTo);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          saleWhere.createdAt.lte = d;
        }
      }
    }
    if (q.controlMin != null || q.controlMax != null) {
      saleWhere.number = {};
      if (q.controlMin != null && Number.isFinite(q.controlMin)) {
        saleWhere.number.gte = Math.trunc(q.controlMin);
      }
      if (q.controlMax != null && Number.isFinite(q.controlMax)) {
        saleWhere.number.lte = Math.trunc(q.controlMax);
      }
    }
    if (q.customerId?.trim()) {
      saleWhere.customerId = q.customerId.trim();
    }
    if (q.customerSegment?.trim()) {
      saleWhere.customer = {
        segment: { equals: q.customerSegment.trim(), mode: 'insensitive' },
      };
    }

    const statusFilter = this.buildStatusFilter(q.authorized, q.contingency);

    const where: Prisma.FiscalDocumentWhereInput = {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      sale: saleWhere,
    };

    const [total, rows] = await Promise.all([
      db.fiscalDocument.count({ where }),
      db.fiscalDocument.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take,
        skip,
        include: {
          sale: {
            include: {
              customer: { select: { id: true, name: true, document: true, segment: true } },
            },
          },
        },
      }),
    ]);

    return {
      total,
      take,
      skip,
      items: rows.map((r) => this.mapListItem(r)),
    };
  }

  /** Relatório: itens de notas filtradas (produto / categoria / CFOP). */
  async reportLines(
    tenantSlug: string,
    q: FiscalDocumentListQuery & {
      productId?: string | null;
      categoryId?: string | null;
      cfop?: string | null;
    },
  ) {
    const list = await this.list(tenantSlug, { ...q, take: Math.min(500, q.take ?? 200), skip: 0 });
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const ids = list.items.map((i) => i.id);
    if (!ids.length) return { total: 0, lines: [] as unknown[] };

    const docs = await db.fiscalDocument.findMany({
      where: { id: { in: ids } },
      include: {
        sale: {
          include: {
            customer: { select: { id: true, name: true } },
            items: {
              include: {
                variant: {
                  include: {
                    product: {
                      select: {
                        id: true,
                        name: true,
                        categoryId: true,
                        category: { select: { id: true, name: true } },
                        fiscalSituation: {
                          select: { cfopInternal: true, cfopInterstate: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const lines: Array<Record<string, unknown>> = [];
    for (const doc of docs) {
      for (const it of doc.sale.items) {
        const product = it.variant.product;
        const cfop =
          product.fiscalSituation?.cfopInternal ??
          product.fiscalSituation?.cfopInterstate ??
          null;
        if (q.productId && product.id !== q.productId) continue;
        if (q.categoryId && product.categoryId !== q.categoryId) continue;
        if (q.cfop?.trim() && (cfop ?? '') !== q.cfop.trim()) continue;
        lines.push({
          documentId: doc.id,
          kind: doc.kind,
          status: doc.status,
          accessKey: doc.accessKey,
          saleId: doc.saleId,
          saleNumber: doc.sale.number,
          saleDate: doc.sale.createdAt.toISOString(),
          customerName: doc.sale.customer?.name ?? null,
          productId: product.id,
          productName: product.name,
          sku: it.variant.sku,
          categoryName: product.category?.name ?? null,
          cfop,
          quantity: it.quantity.toString(),
          unitPrice: it.unitPrice.toString(),
          totalLine: it.totalLine.toString(),
        });
      }
    }
    return { total: lines.length, lines };
  }

  private buildStatusFilter(
    authorized?: boolean,
    contingency?: boolean,
  ): Prisma.EnumFiscalDocumentStatusFilter | FiscalDocumentStatus | undefined {
    const wantAuth = Boolean(authorized);
    const wantCont = Boolean(contingency);
    if (wantAuth && wantCont) {
      return { in: [FiscalDocumentStatus.AUTHORIZED, FiscalDocumentStatus.CONTINGENCY] };
    }
    if (wantAuth) return FiscalDocumentStatus.AUTHORIZED;
    if (wantCont) return FiscalDocumentStatus.CONTINGENCY;
    return undefined;
  }

  private mapListItem(doc: {
    id: string;
    saleId: string;
    kind: FiscalDocumentKind;
    status: FiscalDocumentStatus;
    accessKey: string | null;
    protocol: string | null;
    sefazEnvironment: string | null;
    tpEmis: number;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    sale: {
      id: string;
      number: number;
      total: Prisma.Decimal | string;
      createdAt: Date;
      customerId: string | null;
      customer?: {
        id: string;
        name: string;
        document?: string | null;
        segment?: string | null;
      } | null;
      items?: unknown[];
      payments?: unknown[];
    };
  }) {
    return {
      id: doc.id,
      saleId: doc.saleId,
      kind: doc.kind,
      status: doc.status,
      accessKey: doc.accessKey,
      protocol: doc.protocol,
      sefazEnvironment: doc.sefazEnvironment,
      tpEmis: doc.tpEmis,
      lastError: doc.lastError,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      sale: {
        id: doc.sale.id,
        number: doc.sale.number,
        total: doc.sale.total.toString(),
        createdAt: doc.sale.createdAt.toISOString(),
        customerId: doc.sale.customerId,
        customer: doc.sale.customer
          ? {
              id: doc.sale.customer.id,
              name: doc.sale.customer.name,
              document: doc.sale.customer.document ?? null,
              segment: doc.sale.customer.segment ?? null,
            }
          : null,
        items: doc.sale.items,
        payments: doc.sale.payments,
      },
    };
  }

  /**
   * Cancela documento: se AUTHORIZED com protocolo real, envia evento 110111 à SEFAZ;
   * dry-run / sem protocolo → apenas marca CANCELLED localmente.
   */
  async cancelById(
    tenantSlug: string,
    documentId: string,
    userId: string,
    userRoles: string[],
    permissionPassword?: string,
    xJust?: string,
  ) {
    await this.userPermissions.assertPermission(
      tenantSlug,
      userId,
      userRoles,
      UserPermissionCode.FISCAL_DOC_CANCEL,
      permissionPassword,
    );

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.fiscalDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Documento fiscal não encontrado.');
    if (doc.status === FiscalDocumentStatus.CANCELLED) {
      throw new BadRequestException('Documento fiscal já cancelado.');
    }

    const just =
      (xJust ?? '').trim() ||
      'Cancelamento solicitado pelo emitente no GestorVend.';

    const canSefaz =
      doc.status === FiscalDocumentStatus.AUTHORIZED &&
      doc.accessKey &&
      doc.protocol &&
      doc.protocol !== 'DRY-RUN' &&
      (this.config.get<string>('FISCAL_EMIT_TRANSPORT') ?? 'dry-run').toLowerCase() === 'soap';

    if (canSefaz) {
      const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
      if (!ensured) throw new BadRequestException('Emissor fiscal não configurado.');
      const { company, settings } = ensured;
      const certPath =
        (settings.certificatePath?.trim() ||
          this.config.get<string>('FISCAL_ISSUER_CERT_PATH')?.trim()) ??
        '';
      const certPassword =
        settings.certificatePassword?.trim() ||
        this.config.get<string>('FISCAL_ISSUER_CERT_PASSWORD')?.trim() ||
        '';
      if (!certPath || !certPassword) {
        throw new BadRequestException('Certificado A1 necessário para cancelar na SEFAZ.');
      }
      const material = loadPfxMaterial(certPath, certPassword);
      const agent = createMutualTlsAgentFromPfx(certPath, certPassword);
      const certCnpj = extractCnpjFromPfx(certPath, certPassword);
      const cnpjOk = certCnpj
        ? validateCnpj14(certCnpj)
        : validateCnpj14(digitsCnpj(company.cnpj));
      if (!cnpjOk.ok) throw new BadRequestException('CNPJ inválido para cancelamento.');
      const tpAmb: 1 | 2 =
        settings.sefazEnvironment === FiscalSefazEnvironment.PRODUCAO ? 1 : 2;
      const result = await postCancelamentoNfe({
        production: tpAmb === 1,
        tpAmb,
        cOrgao: ufToCodIbge(settings.uf),
        cnpj14: cnpjOk.cnpj,
        chNFe: doc.accessKey!,
        nProt: doc.protocol!,
        xJust: just,
        privateKeyPem: material.privateKeyPem,
        certificatePem: material.certificatePem,
        agent,
      });
      if (!result.ok && result.cStat !== '573' && result.cStat !== '596') {
        throw new BadRequestException(result.xMotivo || 'SEFAZ rejeitou o cancelamento.');
      }
    }

    return db.fiscalDocument.update({
      where: { id: documentId },
      data: {
        status: FiscalDocumentStatus.CANCELLED,
        lastError: null,
      },
    });
  }

  /** Inutiliza faixa de numeração NFC-e ou NF-e na SEFAZ. */
  async inutilizarNumeracao(
    tenantSlug: string,
    body: {
      kind: 'NFC_E' | 'NF_E';
      serie: number;
      nNFIni: number;
      nNFFin: number;
      xJust: string;
      ano?: number;
    },
  ) {
    if ((this.config.get<string>('FISCAL_EMIT_TRANSPORT') ?? 'dry-run').toLowerCase() !== 'soap') {
      throw new BadRequestException(
        'Inutilização requer FISCAL_EMIT_TRANSPORT=soap e certificado A1.',
      );
    }
    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    if (!ensured) throw new BadRequestException('Emissor fiscal não configurado.');
    const { company, settings } = ensured;
    const certPath =
      (settings.certificatePath?.trim() || this.config.get<string>('FISCAL_ISSUER_CERT_PATH')?.trim()) ??
      '';
    const certPassword =
      settings.certificatePassword?.trim() ||
      this.config.get<string>('FISCAL_ISSUER_CERT_PASSWORD')?.trim() ||
      '';
    if (!certPath || !certPassword) {
      throw new BadRequestException('Certificado A1 necessário.');
    }
    const material = loadPfxMaterial(certPath, certPassword);
    const agent = createMutualTlsAgentFromPfx(certPath, certPassword);
    const certCnpj = extractCnpjFromPfx(certPath, certPassword);
    const cnpjOk = certCnpj
      ? validateCnpj14(certCnpj)
      : validateCnpj14(digitsCnpj(company.cnpj));
    if (!cnpjOk.ok) throw new BadRequestException('CNPJ inválido.');
    const tpAmb: 1 | 2 =
      settings.sefazEnvironment === FiscalSefazEnvironment.PRODUCAO ? 1 : 2;
    const ano = String(body.ano ?? new Date().getFullYear()).slice(-2);
    const mod = body.kind === 'NF_E' ? '55' : '65';
    const inutXml = buildInutilizacaoXml({
      tpAmb,
      cUF: ufToCodIbge(settings.uf),
      ano2: ano,
      cnpj14: cnpjOk.cnpj,
      mod,
      serie: body.serie,
      nNFIni: body.nNFIni,
      nNFFin: body.nNFFin,
      xJust: body.xJust,
      privateKeyPem: material.privateKeyPem,
      certificatePem: material.certificatePem,
    });
    const endpoint = inutilizacaoEndpoint(tpAmb === 1);
    const soap = await postInutilizacao(endpoint, inutXml, agent);
    const parsed = parseInutilizacaoResponse(soap);
    if (!parsed.ok) {
      throw new BadRequestException(parsed.xMotivo);
    }
    return parsed;
  }
}
