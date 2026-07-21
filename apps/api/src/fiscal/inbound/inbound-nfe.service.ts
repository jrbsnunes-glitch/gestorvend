import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateCnpj14, digitsCnpj } from '../../common/cnpj.util';
import {
  FiscalSefazEnvironment,
  GoodsReceiptMode,
  GoodsReceiptStatus,
  InboundNfeStatus,
  Prisma,
} from '../../generated/tenant-client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { GoodsReceiptService } from '../../inventory/goods-receipt.service';
import { FiscalIssuerSettingsService } from '../fiscal-issuer-settings.service';
import { extractCnpjFromPfx } from '../issuer/cert-cnpj';
import { createMutualTlsAgentFromPfx, loadPfxMaterial } from '../issuer/load-pfx';
import { validateNfeAccessKey } from '../utils/nfe-access-key';
import { ufToCodIbge } from '../utils/uf-ibge';
import {
  formatSefazBusinessError,
  formatSefazCallLog,
  formatSefazTransportError,
  maskCnpj,
  parseNfeAccessKeyParts,
  type SefazCallContext,
} from './inbound-nfe.errors';
import { InboundNfeStorage } from './inbound-nfe.storage';
import {
  buildDistDFeIntXml,
  distribuicaoDfeEndpoint,
  parseDistribuicaoDfeBatch,
  parseDistribuicaoDfeResponse,
  parseResNFeSummary,
  postDistribuicaoDfe,
  type DistDocZip,
} from './nfe-distribuicao-dfe.soap';
import { parseInboundNfeXml, extractAccessKeyFromXml } from './nfe-inbound-xml.parser';
import {
  buildManifestacaoEventXml,
  buildRecepcaoEventoEnvXml,
  isManifestTpEvento,
  MANIFEST_CIENCIA_OPERACAO,
  MANIFEST_REQUIRES_JUSTIFICATION,
  parseRecepcaoEventoResponse,
  postRecepcaoEvento,
  recepcaoEventoEndpoint,
  type ManifestTpEvento,
} from './nfe-recepcao-evento.soap';

export type InboundDuplicateInfo = {
  accessKey: string;
  goodsReceiptId: string;
  controlNumber: number;
  documentNumber: string | null;
  createdAt: string;
};

export type SuggestedMatch = {
  lineNumber: number;
  variantId: string | null;
  sku: string | null;
  label: string | null;
  confidence: 'supplier_link' | 'barcode' | 'sku' | 'none';
  supplierProductCode: string | null;
};

export type InboundFetchResponse = {
  duplicate: false;
  cached: boolean;
  manifested: boolean;
  /** XML enviado pelo usuário (Portal Nacional / arquivo local), sem consulta SEFAZ. */
  importedFromFile?: boolean;
  preview: ReturnType<typeof parseInboundNfeXml>;
  suggestedMatches: SuggestedMatch[];
  supplierId: string | null;
  supplierName: string | null;
  unmatchedCount: number;
  warnings: string[];
};

export type InboundDocumentListItem = {
  id: string;
  accessKey: string;
  status: InboundNfeStatus;
  emitterCnpj: string | null;
  emitterName: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  totalValue: string | null;
  itemCount: number | null;
  unmatchedCount: number | null;
  fetchedAt: string;
  goodsReceiptId: string | null;
  /** Presente quando já existe rascunho automático de entrada. */
  draftReceiptControlNumber?: number | null;
  manifestacaoEvento?: string | null;
};

export type InboundDiagnostics = {
  ambiente: 'PRODUCAO' | 'HOMOLOGACAO';
  tpAmb: 1 | 2;
  cnpjConsulta: string;
  cnpjConsultaMasked: string;
  companyCnpj: string | null;
  companyCnpjMatchesCert: boolean | null;
  certificateConfigured: boolean;
  inboundUltNsu: string | null;
  autoReceipt: {
    enabled: boolean;
    postStock: boolean;
    minMatchPercent: number;
  };
  tips: string[];
  accessKey?: {
    key: string;
    emitCnpj: string;
    model: string;
    serie: string;
    number: string;
    note: string;
  } | null;
};

type SefazCtx = {
  agent: ReturnType<typeof createMutualTlsAgentFromPfx>;
  tpAmb: 1 | 2;
  ambiente: 'PRODUCAO' | 'HOMOLOGACAO';
  endpoint: string;
  cUFAutor: string;
  cnpj14: string;
  certPath: string;
  certPassword: string;
  uf: string;
  privateKeyPem: string;
  certificatePem: string;
};

@Injectable()
export class InboundNfeService {
  private readonly log = new Logger(InboundNfeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly issuerSvc: FiscalIssuerSettingsService,
    private readonly storage: InboundNfeStorage,
    private readonly goodsReceipts: GoodsReceiptService,
  ) {}

  async checkDuplicate(tenantSlug: string, accessKeyRaw: string): Promise<InboundDuplicateInfo | null> {
    const validated = validateNfeAccessKey(accessKeyRaw);
    if (!validated.ok) {
      throw new BadRequestException(validated.reason);
    }
    return this.findDuplicateReceipt(tenantSlug, validated.key);
  }

  async fetchByKey(tenantSlug: string, accessKeyRaw: string): Promise<InboundFetchResponse> {
    const validated = validateNfeAccessKey(accessKeyRaw);
    if (!validated.ok) {
      throw new BadRequestException(validated.reason);
    }
    const accessKey = validated.key;

    const duplicate = await this.findDuplicateReceipt(tenantSlug, accessKey);
    if (duplicate) {
      throw new ConflictException({
        message: `Esta NF-e já foi importada na entrada #${duplicate.controlNumber}.`,
        duplicate,
      });
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const existingDoc = await db.inboundNfeDocument.findUnique({ where: { accessKey } });
    let xml: string | null = null;
    let cached = false;
    let manifested = false;
    let nsu: string | undefined;
    let cStat: string | undefined;
    let xMotivo: string | undefined;

    if (existingDoc) {
      xml = await this.storage.readXml(tenantSlug, accessKey);
      // Cache só é válido se for XML completo (nfeProc), não resumo.
      if (xml && (/<nfeProc\b/i.test(xml) || /<NFe\b/i.test(xml))) {
        cached = true;
      } else {
        xml = null;
      }
    }

    if (!xml) {
      const fetched = await this.downloadFullXmlByKey(tenantSlug, accessKey);
      xml = fetched.xml;
      nsu = fetched.nsu;
      cStat = fetched.cStat;
      xMotivo = fetched.xMotivo;
      manifested = fetched.manifested;
      const saved = await this.storage.saveXml(tenantSlug, accessKey, xml);
      const previewEarly = parseInboundNfeXml(xml, accessKey);
      const { unmatchedCount } = await this.buildSuggestions(tenantSlug, previewEarly);
      await db.inboundNfeDocument.upsert({
        where: { accessKey },
        create: {
          accessKey,
          xmlPath: saved.path,
          xmlSha256: saved.sha256,
          nsu: nsu ?? null,
          sefazCStat: cStat ?? null,
          sefazMotivo: xMotivo ?? null,
          status: unmatchedCount > 0 ? InboundNfeStatus.PENDENTE_REVISAO : InboundNfeStatus.COMPLETO,
          manifestacaoEvento: manifested ? MANIFEST_CIENCIA_OPERACAO : null,
          emitterCnpj: previewEarly.emitter.cnpj || null,
          emitterName: previewEarly.emitter.name || null,
          documentNumber: previewEarly.documentNumber,
          issueDate: previewEarly.issueDate ? new Date(previewEarly.issueDate) : null,
          totalValue: previewEarly.totalValue != null ? String(previewEarly.totalValue) : null,
          itemCount: previewEarly.items.length,
          unmatchedCount,
        },
        update: {
          xmlPath: saved.path,
          xmlSha256: saved.sha256,
          nsu: nsu ?? null,
          sefazCStat: cStat ?? null,
          sefazMotivo: xMotivo ?? null,
          status: unmatchedCount > 0 ? InboundNfeStatus.PENDENTE_REVISAO : InboundNfeStatus.COMPLETO,
          manifestacaoEvento: manifested ? MANIFEST_CIENCIA_OPERACAO : undefined,
          emitterCnpj: previewEarly.emitter.cnpj || null,
          emitterName: previewEarly.emitter.name || null,
          documentNumber: previewEarly.documentNumber,
          issueDate: previewEarly.issueDate ? new Date(previewEarly.issueDate) : null,
          totalValue: previewEarly.totalValue != null ? String(previewEarly.totalValue) : null,
          itemCount: previewEarly.items.length,
          unmatchedCount,
          fetchedAt: new Date(),
        },
      });
    }

    if (!xml) {
      throw new NotFoundException('XML da NF-e não encontrado.');
    }

    return this.buildFetchResponse(tenantSlug, xml, accessKey, { cached, manifested });
  }

  /**
   * Importa XML completo (nfeProc) baixado no Portal Nacional — sem chamar SEFAZ.
   * Útil quando consChNFe retorna cStat 137 mas o XML já está disponível.
   */
  async importXml(tenantSlug: string, xmlRaw: string): Promise<InboundFetchResponse> {
    const xml = String(xmlRaw ?? '').trim();
    if (!xml) {
      throw new BadRequestException('Arquivo XML vazio.');
    }
    if (!(/<nfeProc\b/i.test(xml) || /<(?:\w+:)?NFe\b/i.test(xml))) {
      throw new BadRequestException(
        'Arquivo inválido. Envie o XML completo da NF-e (nfeProc ou NFe), como o baixado no Portal Nacional.',
      );
    }

    const keyFromXml = extractAccessKeyFromXml(xml);
    if (!keyFromXml) {
      throw new BadRequestException(
        'Não foi possível ler a chave de acesso (44 dígitos) no XML. Confira se o arquivo é um nfeProc válido.',
      );
    }
    const validated = validateNfeAccessKey(keyFromXml);
    if (!validated.ok) {
      throw new BadRequestException(validated.reason);
    }
    const accessKey = validated.key;

    const duplicate = await this.findDuplicateReceipt(tenantSlug, accessKey);
    if (duplicate) {
      throw new ConflictException({
        message: `Esta NF-e já foi importada na entrada #${duplicate.controlNumber}.`,
        duplicate,
      });
    }

    const previewEarly = parseInboundNfeXml(xml, accessKey);
    if (!previewEarly.items.length) {
      throw new BadRequestException('XML sem itens de produto. Verifique o arquivo.');
    }

    const saved = await this.storage.saveXml(tenantSlug, accessKey, xml);
    const { unmatchedCount } = await this.buildSuggestions(tenantSlug, previewEarly);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    await db.inboundNfeDocument.upsert({
      where: { accessKey },
      create: {
        accessKey,
        xmlPath: saved.path,
        xmlSha256: saved.sha256,
        nsu: null,
        sefazCStat: '100',
        sefazMotivo: 'Importado de arquivo XML (Portal / manual)',
        status: unmatchedCount > 0 ? InboundNfeStatus.PENDENTE_REVISAO : InboundNfeStatus.COMPLETO,
        emitterCnpj: previewEarly.emitter.cnpj || null,
        emitterName: previewEarly.emitter.name || null,
        documentNumber: previewEarly.documentNumber,
        issueDate: previewEarly.issueDate ? new Date(previewEarly.issueDate) : null,
        totalValue: previewEarly.totalValue != null ? String(previewEarly.totalValue) : null,
        itemCount: previewEarly.items.length,
        unmatchedCount,
      },
      update: {
        xmlPath: saved.path,
        xmlSha256: saved.sha256,
        sefazCStat: '100',
        sefazMotivo: 'Importado de arquivo XML (Portal / manual)',
        status: unmatchedCount > 0 ? InboundNfeStatus.PENDENTE_REVISAO : InboundNfeStatus.COMPLETO,
        emitterCnpj: previewEarly.emitter.cnpj || null,
        emitterName: previewEarly.emitter.name || null,
        documentNumber: previewEarly.documentNumber,
        issueDate: previewEarly.issueDate ? new Date(previewEarly.issueDate) : null,
        totalValue: previewEarly.totalValue != null ? String(previewEarly.totalValue) : null,
        itemCount: previewEarly.items.length,
        unmatchedCount,
        fetchedAt: new Date(),
      },
    });

    const response = await this.buildFetchResponse(tenantSlug, xml, accessKey, {
      cached: false,
      manifested: false,
    });
    return { ...response, importedFromFile: true };
  }

  async listDocuments(
    tenantSlug: string,
    opts?: { status?: InboundNfeStatus; take?: number },
  ): Promise<InboundDocumentListItem[]> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.InboundNfeDocumentWhereInput = {};
    if (opts?.status) {
      where.status = opts.status;
    } else {
      where.status = {
        in: [InboundNfeStatus.PENDENTE_REVISAO, InboundNfeStatus.COMPLETO, InboundNfeStatus.RESUMO],
      };
      // Inclui rascunhos automáticos (DRAFT); oculta só entradas já POSTED/IMPORTADO.
      where.OR = [
        { goodsReceiptId: null },
        { goodsReceipt: { status: GoodsReceiptStatus.DRAFT } },
      ];
    }
    const rows = await db.inboundNfeDocument.findMany({
      where,
      orderBy: { fetchedAt: 'desc' },
      take: Math.min(200, Math.max(1, opts?.take ?? 50)),
      include: {
        goodsReceipt: { select: { controlNumber: true, status: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      accessKey: r.accessKey,
      status: r.status,
      emitterCnpj: r.emitterCnpj,
      emitterName: r.emitterName,
      documentNumber: r.documentNumber,
      issueDate: r.issueDate?.toISOString() ?? null,
      totalValue: r.totalValue?.toString() ?? null,
      itemCount: r.itemCount,
      unmatchedCount: r.unmatchedCount,
      fetchedAt: r.fetchedAt.toISOString(),
      goodsReceiptId: r.goodsReceiptId,
      draftReceiptControlNumber:
        r.goodsReceipt?.status === GoodsReceiptStatus.DRAFT
          ? r.goodsReceipt.controlNumber
          : null,
      manifestacaoEvento: r.manifestacaoEvento,
    }));
  }

  /**
   * Checklist WS vs Portal: CNPJ do certificado, ambiente, NSU e análise da chave.
   */
  async getDiagnostics(
    tenantSlug: string,
    accessKeyRaw?: string,
  ): Promise<InboundDiagnostics> {
    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    if (!ensured) {
      throw new BadRequestException('Cadastre a empresa antes de diagnosticar a entrada NF-e.');
    }
    const { company, settings } = ensured;
    const tips: string[] = [];
    const amb =
      settings.sefazEnvironment === FiscalSefazEnvironment.PRODUCAO ? 'PRODUCAO' : 'HOMOLOGACAO';
    const tpAmb: 1 | 2 = amb === 'PRODUCAO' ? 1 : 2;

    const certPath =
      (settings.certificatePath?.trim() || this.config.get<string>('FISCAL_ISSUER_CERT_PATH')?.trim()) ??
      '';
    const certPassword =
      settings.certificatePassword?.trim() ||
      this.config.get<string>('FISCAL_ISSUER_CERT_PASSWORD')?.trim() ||
      '';
    const certificateConfigured = Boolean(certPath && certPassword);

    let cnpjConsulta = digitsCnpj(company.cnpj);
    let companyCnpjMatchesCert: boolean | null = null;
    if (certificateConfigured) {
      try {
        const certCnpjRaw = extractCnpjFromPfx(certPath, certPassword);
        const certOk = certCnpjRaw ? validateCnpj14(certCnpjRaw) : null;
        if (certOk?.ok) {
          cnpjConsulta = certOk.cnpj;
          const companyOk = validateCnpj14(digitsCnpj(company.cnpj));
          if (companyOk.ok) {
            companyCnpjMatchesCert = companyOk.cnpj === cnpjConsulta;
            if (!companyCnpjMatchesCert) {
              tips.push(
                `CNPJ da empresa (${companyOk.cnpj}) difere do certificado A1 (${cnpjConsulta}). A consulta SEFAZ usa o CNPJ do certificado.`,
              );
            }
          }
        }
      } catch {
        tips.push('Não foi possível ler o CNPJ do certificado A1 — confira caminho e senha.');
      }
    } else {
      tips.push('Certificado A1 não configurado — o WS NFeDistribuicaoDFe exige mTLS.');
    }

    if (amb === 'HOMOLOGACAO') {
      tips.push(
        'Ambiente Homologação: notas reais (produção) não aparecem no WS. No Portal Nacional use o ambiente correto; no GestorVend mude para Produção em Empresa → Emissor.',
      );
    }

    if (!settings.inboundUltNsu || settings.inboundUltNsu === '0') {
      tips.push(
        'NSU ainda em 0 — o polling DistDF-e ainda não consumiu documentos. Use “Buscar novas NF-e agora” na caixa de entrada.',
      );
    }

    tips.push(
      'Se o Portal Nacional baixar o XML e o WS retornar cStat 137, importe o arquivo em Entrada → Importar XML. O site e o webservice usam a mesma base do Ambiente Nacional, mas a consulta autentica pelo CNPJ do certificado.',
    );

    let accessKey: InboundDiagnostics['accessKey'] = null;
    if (accessKeyRaw?.trim()) {
      const validated = validateNfeAccessKey(accessKeyRaw);
      if (!validated.ok) {
        tips.push(`Chave inválida: ${validated.reason}`);
      } else {
        const parts = parseNfeAccessKeyParts(validated.key)!;
        accessKey = {
          key: parts.key,
          emitCnpj: parts.emitCnpj,
          model: parts.model,
          serie: parts.serie,
          number: parts.number,
          note:
            'O CNPJ na chave é do emitente (fornecedor), não do destinatário. O WS só devolve a nota se o CNPJ do certificado for destinatário, transportador ou autXML.',
        };
        if (parts.emitCnpj === cnpjConsulta) {
          tips.push(
            'O CNPJ da chave é igual ao do certificado — esta chave parece ser de nota emitida por você. Distribuição DF-e não devolve NF-e próprias; use o XML do emitente ou o Portal apenas para consulta.',
          );
        }
      }
    }

    return {
      ambiente: amb,
      tpAmb,
      cnpjConsulta,
      cnpjConsultaMasked: maskCnpj(cnpjConsulta),
      companyCnpj: digitsCnpj(company.cnpj) || null,
      companyCnpjMatchesCert,
      certificateConfigured,
      inboundUltNsu: settings.inboundUltNsu,
      autoReceipt: {
        enabled: settings.inboundAutoReceiptEnabled,
        postStock: settings.inboundAutoReceiptPostStock,
        minMatchPercent: settings.inboundAutoReceiptMinMatchPercent,
      },
      tips,
      accessKey,
    };
  }

  async getDocumentPreview(tenantSlug: string, accessKeyRaw: string): Promise<InboundFetchResponse> {
    const validated = validateNfeAccessKey(accessKeyRaw);
    if (!validated.ok) {
      throw new BadRequestException(validated.reason);
    }
    const accessKey = validated.key;
    const duplicate = await this.findDuplicateReceipt(tenantSlug, accessKey);
    if (duplicate) {
      throw new ConflictException({
        message: `Esta NF-e já foi importada na entrada #${duplicate.controlNumber}.`,
        duplicate,
      });
    }

    let xml = await this.storage.readXml(tenantSlug, accessKey);
    if (!xml || !(/<nfeProc\b/i.test(xml) || /<NFe\b/i.test(xml))) {
      // Tenta completar via SEFAZ (manifestação se necessário)
      return this.fetchByKey(tenantSlug, accessKey);
    }
    return this.buildFetchResponse(tenantSlug, xml, accessKey, { cached: true, manifested: false });
  }

  async linkReceiptToInboundDoc(
    tenantSlug: string,
    accessKey: string,
    goodsReceiptId: string,
  ): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    await db.inboundNfeDocument.updateMany({
      where: { accessKey, goodsReceiptId: null },
      data: { goodsReceiptId, status: InboundNfeStatus.IMPORTADO },
    });
  }

  /**
   * Polling por NSU (Distribuição DF-e). Retorna quantos documentos novos foram ingeridos.
   */
  async pollDistNsu(tenantSlug: string): Promise<{ ingested: number; ultNSU: string | null }> {
    const transport = (this.config.get<string>('FISCAL_INBOUND_TRANSPORT') ?? 'soap').toLowerCase();
    if (transport === 'dry-run') {
      return { ingested: 0, ultNSU: null };
    }

    const ctx = await this.resolveSefazContext(tenantSlug);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const settings = await this.issuerSvc.ensureForTenant(tenantSlug);
    if (!settings) {
      throw new BadRequestException('Cadastre a empresa e o emissor fiscal antes do polling NSU.');
    }

    let ultNSU = (settings.settings.inboundUltNsu ?? '0').replace(/\D/g, '') || '0';
    let ingested = 0;
    let loops = 0;
    const maxLoops = 20;

    while (loops < maxLoops) {
      loops += 1;
      const distXml = buildDistDFeIntXml({
        tpAmb: ctx.tpAmb,
        cUFAutor: ctx.cUFAutor,
        cnpj14: ctx.cnpj14,
        query: { kind: 'distNSU', ultNSU },
      });

      let soapResponse: string;
      try {
        soapResponse = await postDistribuicaoDfe(ctx.endpoint, distXml, ctx.agent);
      } catch (e) {
        this.log.warn(`Polling NSU falhou (${tenantSlug}): ${(e as Error).message}`);
        throw new BadRequestException(formatSefazTransportError(e, this.toCallCtx(tenantSlug, '', ctx)));
      }

      const batch = parseDistribuicaoDfeBatch(soapResponse);
      if (!batch.ok) {
        this.log.warn(
          `Polling NSU rejeitado (${tenantSlug}): cStat=${batch.cStat} ${batch.xMotivo}`,
        );
        break;
      }

      if (batch.ultNSU) {
        ultNSU = batch.ultNSU;
      }

      for (const doc of batch.docs) {
        const handled = await this.ingestDistDoc(tenantSlug, doc, ctx);
        if (handled) ingested += 1;
      }

      // Sem documentos novos ou já no maxNSU
      if (!batch.docs.length || !batch.maxNSU || ultNSU === batch.maxNSU) {
        break;
      }
    }

    await db.fiscalIssuerSettings.update({
      where: { id: settings.settings.id },
      data: { inboundUltNsu: ultNSU },
    });

    return { ingested, ultNSU };
  }

  private async ingestDistDoc(
    tenantSlug: string,
    doc: DistDocZip,
    ctx: SefazCtx,
  ): Promise<boolean> {
    const db = await this.tenantPrisma.getClient(tenantSlug);

    if (doc.kind === 'resNFe') {
      const summary = parseResNFeSummary(doc.xml);
      const accessKey = summary.accessKey ?? doc.accessKey;
      if (!accessKey || !validateNfeAccessKey(accessKey).ok) return false;

      const already = await db.goodsReceipt.findFirst({
        where: { nfeAccessKey: accessKey },
        select: { id: true },
      });
      if (already) return false;

      // Ciência da Operação para liberar XML completo
      let manifestProt: string | null = null;
      try {
        const man = await this.registerCienciaOperacao(tenantSlug, accessKey, ctx);
        manifestProt = man.nProt ?? null;
      } catch (e) {
        this.log.warn(
          `Manifestação automática falhou para ${accessKey}: ${(e as Error).message}`,
        );
      }

      // Tenta baixar o XML completo
      try {
        const fetched = await this.downloadFullXmlByKey(tenantSlug, accessKey, ctx);
        const saved = await this.storage.saveXml(tenantSlug, accessKey, fetched.xml);
        const preview = parseInboundNfeXml(fetched.xml, accessKey);
        const { unmatchedCount } = await this.buildSuggestions(tenantSlug, preview);
        await db.inboundNfeDocument.upsert({
          where: { accessKey },
          create: {
            accessKey,
            xmlPath: saved.path,
            xmlSha256: saved.sha256,
            nsu: doc.nsu ?? fetched.nsu ?? null,
            sefazCStat: fetched.cStat ?? null,
            sefazMotivo: fetched.xMotivo ?? null,
            status: unmatchedCount > 0 ? InboundNfeStatus.PENDENTE_REVISAO : InboundNfeStatus.COMPLETO,
            manifestacaoEvento: MANIFEST_CIENCIA_OPERACAO,
            manifestacaoProtocolo: manifestProt,
            emitterCnpj: preview.emitter.cnpj || summary.emitterCnpj,
            emitterName: preview.emitter.name || summary.emitterName,
            documentNumber: preview.documentNumber ?? summary.documentNumber,
            issueDate: preview.issueDate
              ? new Date(preview.issueDate)
              : summary.issueDate
                ? new Date(summary.issueDate)
                : null,
            totalValue:
              preview.totalValue != null
                ? String(preview.totalValue)
                : summary.totalValue != null
                  ? String(summary.totalValue)
                  : null,
            itemCount: preview.items.length,
            unmatchedCount,
          },
          update: {
            xmlPath: saved.path,
            xmlSha256: saved.sha256,
            nsu: doc.nsu ?? fetched.nsu ?? null,
            status: unmatchedCount > 0 ? InboundNfeStatus.PENDENTE_REVISAO : InboundNfeStatus.COMPLETO,
            manifestacaoEvento: MANIFEST_CIENCIA_OPERACAO,
            manifestacaoProtocolo: manifestProt ?? undefined,
            emitterCnpj: preview.emitter.cnpj || summary.emitterCnpj,
            emitterName: preview.emitter.name || summary.emitterName,
            documentNumber: preview.documentNumber ?? summary.documentNumber,
            itemCount: preview.items.length,
            unmatchedCount,
            fetchedAt: new Date(),
          },
        });
        await this.tryAutoReceipt(tenantSlug, accessKey);
        return true;
      } catch (e) {
        // Guarda só o resumo se o XML completo ainda não estiver disponível
        const stubXml = doc.xml;
        const saved = await this.storage.saveXml(tenantSlug, accessKey, stubXml);
        await db.inboundNfeDocument.upsert({
          where: { accessKey },
          create: {
            accessKey,
            xmlPath: saved.path,
            xmlSha256: saved.sha256,
            nsu: doc.nsu ?? null,
            status: InboundNfeStatus.RESUMO,
            manifestacaoEvento: MANIFEST_CIENCIA_OPERACAO,
            manifestacaoProtocolo: manifestProt,
            emitterCnpj: summary.emitterCnpj,
            emitterName: summary.emitterName,
            documentNumber: summary.documentNumber,
            issueDate: summary.issueDate ? new Date(summary.issueDate) : null,
            totalValue: summary.totalValue != null ? String(summary.totalValue) : null,
          },
          update: {
            status: InboundNfeStatus.RESUMO,
            nsu: doc.nsu ?? null,
            manifestacaoProtocolo: manifestProt ?? undefined,
            fetchedAt: new Date(),
          },
        });
        this.log.warn(
          `XML completo ainda indisponível para ${accessKey}: ${(e as Error).message}`,
        );
        return true;
      }
    }

    if (doc.kind === 'procNFe') {
      const accessKey = doc.accessKey ?? extractChNFe(doc.xml);
      if (!accessKey || !validateNfeAccessKey(accessKey).ok) return false;
      const already = await db.goodsReceipt.findFirst({
        where: { nfeAccessKey: accessKey },
        select: { id: true },
      });
      if (already) return false;

      const saved = await this.storage.saveXml(tenantSlug, accessKey, doc.xml);
      const preview = parseInboundNfeXml(doc.xml, accessKey);
      const { unmatchedCount } = await this.buildSuggestions(tenantSlug, preview);
      await db.inboundNfeDocument.upsert({
        where: { accessKey },
        create: {
          accessKey,
          xmlPath: saved.path,
          xmlSha256: saved.sha256,
          nsu: doc.nsu ?? null,
          status: unmatchedCount > 0 ? InboundNfeStatus.PENDENTE_REVISAO : InboundNfeStatus.COMPLETO,
          emitterCnpj: preview.emitter.cnpj || null,
          emitterName: preview.emitter.name || null,
          documentNumber: preview.documentNumber,
          issueDate: preview.issueDate ? new Date(preview.issueDate) : null,
          totalValue: preview.totalValue != null ? String(preview.totalValue) : null,
          itemCount: preview.items.length,
          unmatchedCount,
        },
        update: {
          xmlPath: saved.path,
          xmlSha256: saved.sha256,
          nsu: doc.nsu ?? null,
          status: unmatchedCount > 0 ? InboundNfeStatus.PENDENTE_REVISAO : InboundNfeStatus.COMPLETO,
          emitterCnpj: preview.emitter.cnpj || null,
          emitterName: preview.emitter.name || null,
          documentNumber: preview.documentNumber,
          itemCount: preview.items.length,
          unmatchedCount,
          fetchedAt: new Date(),
        },
      });
      await this.tryAutoReceipt(tenantSlug, accessKey);
      return true;
    }

    return false;
  }

  private async buildFetchResponse(
    tenantSlug: string,
    xml: string,
    accessKey: string,
    flags: { cached: boolean; manifested: boolean },
  ): Promise<InboundFetchResponse> {
    const preview = parseInboundNfeXml(xml, accessKey);
    const warnings: string[] = [];

    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    const companyCnpj = ensured?.company.cnpj.replace(/\D/g, '') ?? '';
    if (companyCnpj && preview.recipient.cnpj && preview.recipient.cnpj !== companyCnpj) {
      warnings.push(
        'CNPJ destinatário da NF-e difere do CNPJ cadastrado na empresa. Confira antes de lançar.',
      );
    }

    const { suggestedMatches, supplierId, supplierName, unmatchedCount } =
      await this.buildSuggestions(tenantSlug, preview);

    if (unmatchedCount > 0) {
      warnings.push(
        `${unmatchedCount} item(ns) sem correspondência no cadastro. Resolva antes de lançar a entrada.`,
      );
    }
    if (flags.manifested) {
      warnings.push(
        'Foi registrada automaticamente a Ciência da Operação para liberar o XML completo na SEFAZ.',
      );
    }

    return {
      duplicate: false,
      cached: flags.cached,
      manifested: flags.manifested,
      preview,
      suggestedMatches,
      supplierId,
      supplierName,
      unmatchedCount,
      warnings,
    };
  }

  private async findDuplicateReceipt(
    tenantSlug: string,
    accessKey: string,
  ): Promise<InboundDuplicateInfo | null> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const receipt = await db.goodsReceipt.findFirst({
      where: { nfeAccessKey: accessKey },
      select: {
        id: true,
        controlNumber: true,
        documentNumber: true,
        createdAt: true,
      },
    });
    if (!receipt) return null;
    return {
      accessKey,
      goodsReceiptId: receipt.id,
      controlNumber: receipt.controlNumber,
      documentNumber: receipt.documentNumber,
      createdAt: receipt.createdAt.toISOString(),
    };
  }

  /**
   * Baixa XML completo por chave. Se a SEFAZ devolver só resumo, registra Ciência
   * da Operação e tenta novamente.
   */
  private async downloadFullXmlByKey(
    tenantSlug: string,
    accessKey: string,
    existingCtx?: SefazCtx,
  ): Promise<{
    xml: string;
    nsu?: string;
    cStat?: string;
    xMotivo?: string;
    manifested: boolean;
  }> {
    const transport = (this.config.get<string>('FISCAL_INBOUND_TRANSPORT') ?? 'soap').toLowerCase();
    if (transport === 'dry-run') {
      throw new BadRequestException(
        'Download SEFAZ desativado (FISCAL_INBOUND_TRANSPORT=dry-run). Configure certificado A1 e use soap.',
      );
    }

    const ctx = existingCtx ?? (await this.resolveSefazContext(tenantSlug));
    const callCtx = this.toCallCtx(tenantSlug, accessKey, ctx);

    this.log.log(`Consulta NF-e entrada: ${formatSefazCallLog(callCtx)}`);

    let first = await this.consultChNFe(ctx, accessKey, callCtx);
    let manifested = false;

    if (!first.ok && first.isSummaryOnly) {
      this.log.log(`Resumo recebido para ${accessKey}; registrando Ciência da Operação…`);
      await this.registerCienciaOperacao(tenantSlug, accessKey, ctx);
      manifested = true;
      // Pequena pausa para o Ambiente Nacional processar o evento
      await sleep(1500);
      first = await this.consultChNFe(ctx, accessKey, callCtx);
    }

    if (!first.ok) {
      this.log.warn(
        `SEFAZ rejeitou consulta: ${formatSefazCallLog(callCtx)} | cStat=${first.cStat} | ${first.xMotivo}`,
      );
      throw new BadRequestException(
        formatSefazBusinessError(first.xMotivo, first.cStat, callCtx),
      );
    }

    if (first.kind !== 'procNFe' && !/<nfeProc\b/i.test(first.xml) && !/<NFe\b/i.test(first.xml)) {
      throw new BadRequestException(
        'A SEFAZ ainda não liberou o XML completo desta NF-e. Aguarde alguns minutos após a Ciência da Operação e tente novamente.',
      );
    }

    this.log.log(
      `NF-e baixada: ${formatSefazCallLog(callCtx)} | cStat=${first.cStat} | nsu=${first.nsu ?? '-'} | manifested=${manifested}`,
    );
    return {
      xml: first.xml,
      nsu: first.nsu,
      cStat: first.cStat,
      xMotivo: first.xMotivo,
      manifested,
    };
  }

  private async consultChNFe(ctx: SefazCtx, accessKey: string, callCtx: SefazCallContext) {
    const distXml = buildDistDFeIntXml({
      tpAmb: ctx.tpAmb,
      cUFAutor: ctx.cUFAutor,
      cnpj14: ctx.cnpj14,
      query: { kind: 'consChNFe', chNFe: accessKey },
    });
    let soapResponse: string;
    try {
      soapResponse = await postDistribuicaoDfe(ctx.endpoint, distXml, ctx.agent);
    } catch (e) {
      this.log.warn(
        `Falha transporte SEFAZ: ${formatSefazCallLog(callCtx)} | ${(e as Error).message}`,
      );
      throw new BadRequestException(formatSefazTransportError(e, callCtx));
    }
    return parseDistribuicaoDfeResponse(soapResponse);
  }

  async registerCienciaOperacao(
    tenantSlug: string,
    accessKey: string,
    existingCtx?: SefazCtx,
  ): Promise<{ nProt?: string; cStat: string }> {
    return this.registerManifestacao(tenantSlug, {
      accessKey,
      tpEvento: MANIFEST_CIENCIA_OPERACAO,
    }, existingCtx);
  }

  /**
   * Manifestação do destinatário (210200 / 210210 / 210220 / 210240).
   * Ciência (210210) continua sendo automática no download; demais eventos são manuais.
   */
  async registerManifestacao(
    tenantSlug: string,
    input: { accessKey: string; tpEvento: string; xJust?: string | null },
    existingCtx?: SefazCtx,
  ): Promise<{ nProt?: string; cStat: string; tpEvento: ManifestTpEvento }> {
    const validated = validateNfeAccessKey(input.accessKey);
    if (!validated.ok) {
      throw new BadRequestException(validated.reason);
    }
    const accessKey = validated.key;
    if (!isManifestTpEvento(input.tpEvento)) {
      throw new BadRequestException(
        'tpEvento inválido. Use 210200 (Confirmação), 210210 (Ciência), 210220 (Desconhecimento) ou 210240 (Não realizada).',
      );
    }
    const tpEvento = input.tpEvento;
    if (MANIFEST_REQUIRES_JUSTIFICATION.has(tpEvento)) {
      const just = (input.xJust ?? '').trim();
      if (just.length < 15) {
        throw new BadRequestException(
          'Informe justificativa com no mínimo 15 caracteres para este evento.',
        );
      }
    }

    const ctx = existingCtx ?? (await this.resolveSefazContext(tenantSlug));
    let eventoXml: string;
    try {
      ({ eventoXml } = buildManifestacaoEventXml({
        tpAmb: ctx.tpAmb,
        cOrgao: '91',
        cnpj14: ctx.cnpj14,
        chNFe: accessKey,
        tpEvento,
        xJust: input.xJust,
        privateKeyPem: ctx.privateKeyPem,
        certificatePem: ctx.certificatePem,
      }));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const idLote = String(Date.now()).slice(-15);
    const envXml = buildRecepcaoEventoEnvXml({
      tpAmb: ctx.tpAmb,
      idLote,
      eventoXml,
    });
    const endpoint = recepcaoEventoEndpoint(ctx.tpAmb === 1);

    let soapResponse: string;
    try {
      soapResponse = await postRecepcaoEvento(endpoint, envXml, ctx.agent);
    } catch (e) {
      throw new BadRequestException(
        `Falha ao enviar manifestação ${tpEvento}: ${(e as Error).message}`,
      );
    }

    const parsed = parseRecepcaoEventoResponse(soapResponse);
    if (!parsed.ok) {
      if (parsed.cStat === '573' || parsed.cStat === '596') {
        this.log.log(`Evento ${tpEvento} já registrado para ${accessKey} (cStat ${parsed.cStat}).`);
        return { cStat: parsed.cStat, nProt: undefined, tpEvento };
      }
      throw new BadRequestException(
        parsed.xMotivo || `SEFAZ rejeitou manifestação ${tpEvento} (cStat ${parsed.cStat}).`,
      );
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    await db.inboundNfeDocument.updateMany({
      where: { accessKey },
      data: {
        manifestacaoEvento: tpEvento,
        manifestacaoProtocolo: parsed.nProt ?? null,
      },
    });

    return { nProt: parsed.nProt, cStat: parsed.cStat, tpEvento };
  }

  /**
   * Reconsulta um NSU pontual (consNSU) — útil quando o doc ficou em RESUMO.
   */
  async reprocessNsu(
    tenantSlug: string,
    nsuRaw: string,
  ): Promise<{ ok: boolean; message: string; accessKey?: string }> {
    const nsu = nsuRaw.replace(/\D/g, '').padStart(15, '0');
    if (!nsu || nsu === '000000000000000') {
      throw new BadRequestException('Informe um NSU válido.');
    }
    const ctx = await this.resolveSefazContext(tenantSlug);
    const callCtx = this.toCallCtx(tenantSlug, '', ctx);
    const distXml = buildDistDFeIntXml({
      tpAmb: ctx.tpAmb,
      cUFAutor: ctx.cUFAutor,
      cnpj14: ctx.cnpj14,
      query: { kind: 'consNSU', nsu },
    });
    let soapResponse: string;
    try {
      soapResponse = await postDistribuicaoDfe(ctx.endpoint, distXml, ctx.agent);
    } catch (e) {
      throw new BadRequestException(formatSefazTransportError(e, callCtx));
    }
    const batch = parseDistribuicaoDfeBatch(soapResponse);
    if (!batch.ok) {
      throw new BadRequestException(
        formatSefazBusinessError(batch.xMotivo, batch.cStat, callCtx),
      );
    }
    if (!batch.docs.length) {
      return { ok: false, message: `NSU ${nsu}: nenhum documento (cStat ${batch.cStat}).` };
    }
    let lastKey: string | undefined;
    for (const doc of batch.docs) {
      await this.ingestDistDoc(tenantSlug, doc, ctx);
      lastKey = doc.accessKey ?? lastKey;
    }
    return {
      ok: true,
      message: `NSU ${nsu}: ${batch.docs.length} documento(s) reprocessado(s).`,
      accessKey: lastKey,
    };
  }

  /** Tenta criar entrada automática (rascunho ou postada) conforme regras do emissor. */
  private async tryAutoReceipt(tenantSlug: string, accessKey: string): Promise<void> {
    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    if (!ensured?.settings.inboundAutoReceiptEnabled) return;

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.inboundNfeDocument.findUnique({ where: { accessKey } });
    if (!doc || doc.goodsReceiptId || doc.status === InboundNfeStatus.RESUMO) return;
    if (doc.status === InboundNfeStatus.IMPORTADO) return;

    const existing = await db.goodsReceipt.findFirst({
      where: { nfeAccessKey: accessKey },
      select: { id: true },
    });
    if (existing) return;

    const xml = await this.storage.readXml(tenantSlug, accessKey);
    if (!xml || !(/<nfeProc\b/i.test(xml) || /<NFe\b/i.test(xml))) return;

    const preview = parseInboundNfeXml(xml, accessKey);
    const { suggestedMatches, supplierId, unmatchedCount } = await this.buildSuggestions(
      tenantSlug,
      preview,
    );
    const itemCount = preview.items.length;
    if (itemCount === 0) return;
    const matched = itemCount - unmatchedCount;
    const matchPercent = Math.round((matched / itemCount) * 100);
    const minPct = Math.max(0, Math.min(100, ensured.settings.inboundAutoReceiptMinMatchPercent));
    if (matchPercent < minPct) {
      this.log.log(
        `Auto-entrada ${accessKey}: match ${matchPercent}% < mínimo ${minPct}% — ignorado.`,
      );
      return;
    }
    if (!supplierId) {
      this.log.log(`Auto-entrada ${accessKey}: fornecedor não cadastrado — ignorado.`);
      return;
    }
    if (suggestedMatches.some((m) => !m.variantId)) {
      this.log.log(`Auto-entrada ${accessKey}: ainda há item sem variantId — ignorado.`);
      return;
    }

    const location = await db.stockLocation.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!location) {
      this.log.warn(`Auto-entrada ${accessKey}: nenhum local de estoque padrão.`);
      return;
    }

    const postStock = ensured.settings.inboundAutoReceiptPostStock;
    try {
      const receipt = await this.goodsReceipts.create(tenantSlug, {
        mode: GoodsReceiptMode.WITH_NFE_KEY,
        nfeAccessKey: accessKey,
        supplierId,
        locationId: location.id,
        documentNumber: preview.documentNumber,
        series: preview.series,
        issueDate: preview.issueDate,
        natureOperation: preview.natureOperation,
        totalValue: preview.totalValue,
        notes: postStock
          ? 'Entrada automática (caixa NF-e) — estoque lançado.'
          : 'Rascunho automático (caixa NF-e) — revise e confirme o estoque.',
        userId: null,
        status: postStock ? GoodsReceiptStatus.POSTED : GoodsReceiptStatus.DRAFT,
        items: preview.items.map((item) => {
          const match = suggestedMatches.find((m) => m.lineNumber === item.lineNumber)!;
          return {
            variantId: match.variantId!,
            quantity: item.quantity,
            unitCost: item.unitCost,
            ncm: item.ncm,
            cfop: item.cfop,
            description: item.description,
            supplierProductCode: match.supplierProductCode ?? item.supplierCode,
            invoiceUnit: item.unit,
            invoiceQuantity: item.quantity,
          };
        }),
      });
      this.log.log(
        `Auto-entrada ${accessKey}: #${receipt.controlNumber} (${postStock ? 'POSTED' : 'DRAFT'}).`,
      );
    } catch (e) {
      this.log.warn(`Auto-entrada falhou para ${accessKey}: ${(e as Error).message}`);
    }
  }

  private async resolveSefazContext(tenantSlug: string): Promise<SefazCtx> {
    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    if (!ensured) {
      throw new BadRequestException('Cadastre a empresa e o emissor fiscal antes de buscar NF-e.');
    }
    const { company, settings } = ensured;
    const companyCnpjRaw = digitsCnpj(company.cnpj);

    const certPath =
      (settings.certificatePath?.trim() || this.config.get<string>('FISCAL_ISSUER_CERT_PATH')?.trim()) ??
      '';
    const certPassword =
      settings.certificatePassword?.trim() ||
      this.config.get<string>('FISCAL_ISSUER_CERT_PASSWORD')?.trim() ||
      '';
    if (!certPath || !certPassword) {
      throw new BadRequestException(
        'Certificado A1 não configurado. Informe caminho e senha do .pfx em Empresa → Emissor fiscal.',
      );
    }

    const certCnpj = extractCnpjFromPfx(certPath, certPassword);
    const companyCnpjValid = validateCnpj14(companyCnpjRaw);
    const certCnpjValid = certCnpj ? validateCnpj14(certCnpj) : null;

    let cnpj14: string;
    if (certCnpjValid?.ok) {
      cnpj14 = certCnpjValid.cnpj;
      if (companyCnpjValid.ok && companyCnpjValid.cnpj !== cnpj14) {
        this.log.warn(
          `CNPJ da empresa (${companyCnpjValid.cnpj}) difere do certificado A1 (${cnpj14}); consulta SEFAZ usará o CNPJ do certificado.`,
        );
      }
    } else if (companyCnpjValid.ok) {
      cnpj14 = companyCnpjValid.cnpj;
    } else {
      throw new BadRequestException(
        'CNPJ inválido para consulta SEFAZ. Corrija o CNPJ em Empresa ou use um certificado e-CNPJ válido. ' +
          (companyCnpjValid.ok === false ? companyCnpjValid.reason : ''),
      );
    }

    let agent;
    let privateKeyPem: string;
    let certificatePem: string;
    try {
      agent = createMutualTlsAgentFromPfx(certPath, certPassword);
      const material = loadPfxMaterial(certPath, certPassword);
      privateKeyPem = material.privateKeyPem;
      certificatePem = material.certificatePem;
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const tpAmb: 1 | 2 =
      settings.sefazEnvironment === FiscalSefazEnvironment.PRODUCAO ? 1 : 2;
    const ambiente = tpAmb === 1 ? 'PRODUCAO' : 'HOMOLOGACAO';
    const endpoint = distribuicaoDfeEndpoint(tpAmb === 1);
    const cUFAutor = ufToCodIbge(settings.uf);

    return {
      agent,
      tpAmb,
      ambiente,
      endpoint,
      cUFAutor,
      cnpj14,
      certPath,
      certPassword,
      uf: settings.uf,
      privateKeyPem,
      certificatePem,
    };
  }

  private toCallCtx(tenantSlug: string, accessKey: string, ctx: SefazCtx): SefazCallContext {
    return {
      tenantSlug,
      accessKey,
      ambiente: ctx.ambiente,
      tpAmb: ctx.tpAmb,
      endpoint: ctx.endpoint,
      uf: ctx.uf,
      cUFAutor: ctx.cUFAutor,
      cnpj14: ctx.cnpj14,
      certPath: ctx.certPath,
    };
  }

  private async buildSuggestions(
    tenantSlug: string,
    preview: ReturnType<typeof parseInboundNfeXml>,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);

    let supplierId: string | null = null;
    let supplierName: string | null = null;
    const emitDoc = preview.emitter.cnpj;
    if (emitDoc) {
      const suppliers = await db.supplier.findMany({
        where: { document: { not: null } },
        select: { id: true, legalName: true, document: true },
      });
      const supplier = suppliers.find((s) => s.document?.replace(/\D/g, '') === emitDoc);
      if (supplier) {
        supplierId = supplier.id;
        supplierName = supplier.legalName;
      } else {
        supplierName = preview.emitter.name;
      }
    }

    const variants = await db.productVariant.findMany({
      select: {
        id: true,
        sku: true,
        barcode: true,
        product: { select: { name: true, ncm: true } },
      },
    });

    const linkByCode = new Map<string, (typeof variants)[0]>();
    if (supplierId) {
      const links = await db.supplierProductLink.findMany({
        where: { supplierId },
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              barcode: true,
              product: { select: { name: true, ncm: true } },
            },
          },
        },
      });
      for (const link of links) {
        linkByCode.set(link.supplierProductCode.trim(), link.variant as (typeof variants)[0]);
      }
    }

    const suggestedMatches: SuggestedMatch[] = preview.items.map((item) => {
      const ean = (item.ean ?? '').replace(/\D/g, '');
      const code = (item.supplierCode ?? '').trim();
      let match: (typeof variants)[0] | undefined;
      let confidence: SuggestedMatch['confidence'] = 'none';

      if (code && linkByCode.has(code)) {
        match = linkByCode.get(code);
        confidence = 'supplier_link';
      }
      if (!match && ean && ean !== 'SEM GTIN') {
        match = variants.find((v) => (v.barcode ?? '').replace(/\D/g, '') === ean);
        if (match) confidence = 'barcode';
      }
      if (!match && code) {
        match = variants.find((v) => v.sku === code);
        if (match) confidence = 'sku';
      }

      return {
        lineNumber: item.lineNumber,
        variantId: match?.id ?? null,
        sku: match?.sku ?? null,
        label: match ? `${match.sku} — ${match.product.name}` : null,
        confidence,
        supplierProductCode: code || null,
      };
    });

    const unmatchedCount = suggestedMatches.filter((m) => !m.variantId).length;
    return { suggestedMatches, supplierId, supplierName, unmatchedCount };
  }
}

function extractChNFe(xml: string): string | undefined {
  return (
    xml.match(/<chNFe>(\d{44})<\/chNFe>/i)?.[1] ??
    xml.match(/\bId="NFe(\d{44})"/i)?.[1] ??
    undefined
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
