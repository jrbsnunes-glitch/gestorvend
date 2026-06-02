import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateCnpj14, digitsCnpj } from '../../common/cnpj.util';
import { FiscalSefazEnvironment } from '../../generated/tenant-client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { FiscalIssuerSettingsService } from '../fiscal-issuer-settings.service';
import { extractCnpjFromPfx } from '../issuer/cert-cnpj';
import { createMutualTlsAgentFromPfx } from '../issuer/load-pfx';
import { validateNfeAccessKey } from '../utils/nfe-access-key';
import { ufToCodIbge } from '../utils/uf-ibge';
import {
  formatSefazBusinessError,
  formatSefazCallLog,
  formatSefazTransportError,
  type SefazCallContext,
} from './inbound-nfe.errors';
import { InboundNfeStorage } from './inbound-nfe.storage';
import {
  buildDistDFeIntXml,
  distribuicaoDfeEndpoint,
  parseDistribuicaoDfeResponse,
  postDistribuicaoDfe,
} from './nfe-distribuicao-dfe.soap';
import { parseInboundNfeXml } from './nfe-inbound-xml.parser';

export type InboundDuplicateInfo = {
  accessKey: string;
  goodsReceiptId: string;
  controlNumber: number;
  documentNumber: string | null;
  createdAt: string;
};

export type InboundFetchResponse = {
  duplicate: false;
  cached: boolean;
  preview: ReturnType<typeof parseInboundNfeXml>;
  suggestedMatches: Array<{
    lineNumber: number;
    variantId: string | null;
    sku: string | null;
    label: string | null;
    confidence: 'barcode' | 'sku' | 'none';
  }>;
  supplierId: string | null;
  supplierName: string | null;
  warnings: string[];
};

@Injectable()
export class InboundNfeService {
  private readonly log = new Logger(InboundNfeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly issuerSvc: FiscalIssuerSettingsService,
    private readonly storage: InboundNfeStorage,
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
    let nsu: string | undefined;
    let cStat: string | undefined;
    let xMotivo: string | undefined;

    if (existingDoc) {
      xml = await this.storage.readXml(tenantSlug, accessKey);
      cached = Boolean(xml);
    }

    if (!xml) {
      const fetched = await this.downloadFromSefaz(tenantSlug, accessKey);
      xml = fetched.xml;
      nsu = fetched.nsu;
      cStat = fetched.cStat;
      xMotivo = fetched.xMotivo;
      const saved = await this.storage.saveXml(tenantSlug, accessKey, xml);
      await db.inboundNfeDocument.upsert({
        where: { accessKey },
        create: {
          accessKey,
          xmlPath: saved.path,
          xmlSha256: saved.sha256,
          nsu: nsu ?? null,
          sefazCStat: cStat ?? null,
          sefazMotivo: xMotivo ?? null,
        },
        update: {
          xmlPath: saved.path,
          xmlSha256: saved.sha256,
          nsu: nsu ?? null,
          sefazCStat: cStat ?? null,
          sefazMotivo: xMotivo ?? null,
          fetchedAt: new Date(),
        },
      });
    }

    if (!xml) {
      throw new NotFoundException('XML da NF-e não encontrado.');
    }

    const preview = parseInboundNfeXml(xml, accessKey);
    const warnings: string[] = [];

    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    const companyCnpj = ensured?.company.cnpj.replace(/\D/g, '') ?? '';
    if (companyCnpj && preview.recipient.cnpj && preview.recipient.cnpj !== companyCnpj) {
      warnings.push(
        'CNPJ destinatário da NF-e difere do CNPJ cadastrado na empresa. Confira antes de lançar.',
      );
    }

    const { suggestedMatches, supplierId, supplierName } = await this.buildSuggestions(
      tenantSlug,
      preview,
    );

    return {
      duplicate: false,
      cached,
      preview,
      suggestedMatches,
      supplierId,
      supplierName,
      warnings,
    };
  }

  async linkReceiptToInboundDoc(
    tenantSlug: string,
    accessKey: string,
    goodsReceiptId: string,
  ): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    await db.inboundNfeDocument.updateMany({
      where: { accessKey, goodsReceiptId: null },
      data: { goodsReceiptId },
    });
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

  private async downloadFromSefaz(
    tenantSlug: string,
    accessKey: string,
  ): Promise<{ xml: string; nsu?: string; cStat?: string; xMotivo?: string }> {
    const transport = (this.config.get<string>('FISCAL_INBOUND_TRANSPORT') ?? 'soap').toLowerCase();
    if (transport === 'dry-run') {
      throw new BadRequestException(
        'Download SEFAZ desativado (FISCAL_INBOUND_TRANSPORT=dry-run). Configure certificado A1 e use soap.',
      );
    }

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
      } else if (!companyCnpjValid.ok) {
        this.log.warn(
          `CNPJ cadastrado na empresa é inválido (${companyCnpjRaw}); consulta SEFAZ usará o CNPJ do certificado (${cnpj14}).`,
        );
      }
    } else if (companyCnpjValid.ok) {
      cnpj14 = companyCnpjValid.cnpj;
    } else {
      throw new BadRequestException(
        'CNPJ inválido para consulta SEFAZ. Corrija o CNPJ em Empresa (com dígitos verificadores corretos) ' +
          'ou use um certificado e-CNPJ cujo titular conste no arquivo .pfx. ' +
        (companyCnpjValid.ok === false ? companyCnpjValid.reason : 'Não foi possível ler o CNPJ do certificado.'),
      );
    }

    let agent;
    try {
      agent = createMutualTlsAgentFromPfx(certPath, certPassword);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const tpAmb: 1 | 2 =
      settings.sefazEnvironment === FiscalSefazEnvironment.PRODUCAO ? 1 : 2;
    const ambiente = tpAmb === 1 ? 'PRODUCAO' : 'HOMOLOGACAO';
    const endpoint = distribuicaoDfeEndpoint(tpAmb === 1);
    const cUFAutor = ufToCodIbge(settings.uf);
    const callCtx: SefazCallContext = {
      tenantSlug,
      accessKey,
      ambiente,
      tpAmb,
      endpoint,
      uf: settings.uf,
      cUFAutor,
      cnpj14,
      certPath,
    };

    this.log.log(`Consulta NF-e entrada: ${formatSefazCallLog(callCtx)}`);

    const distXml = buildDistDFeIntXml({
      tpAmb,
      cUFAutor,
      cnpj14,
      chNFe: accessKey,
    });

    let soapResponse: string;
    try {
      soapResponse = await postDistribuicaoDfe(endpoint, distXml, agent);
    } catch (e) {
      this.log.warn(
        `Falha transporte SEFAZ: ${formatSefazCallLog(callCtx)} | ${(e as Error).message}`,
      );
      throw new BadRequestException(formatSefazTransportError(e, callCtx));
    }

    const parsed = parseDistribuicaoDfeResponse(soapResponse);
    if (!parsed.ok) {
      this.log.warn(
        `SEFAZ rejeitou consulta: ${formatSefazCallLog(callCtx)} | cStat=${parsed.cStat} | ${parsed.xMotivo}`,
      );
      throw new BadRequestException(
        formatSefazBusinessError(parsed.xMotivo, parsed.cStat, callCtx),
      );
    }

    this.log.log(
      `NF-e baixada: ${formatSefazCallLog(callCtx)} | cStat=${parsed.cStat} | nsu=${parsed.nsu ?? '-'}`,
    );
    return {
      xml: parsed.xml,
      nsu: parsed.nsu,
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
    };
  }

  private async buildSuggestions(
    tenantSlug: string,
    preview: ReturnType<typeof parseInboundNfeXml>,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const variants = await db.productVariant.findMany({
      select: {
        id: true,
        sku: true,
        barcode: true,
        product: { select: { name: true, ncm: true } },
      },
    });

    const suggestedMatches = preview.items.map((item) => {
      const ean = (item.ean ?? '').replace(/\D/g, '');
      const code = (item.supplierCode ?? '').trim();
      let match: (typeof variants)[0] | undefined;
      let confidence: 'barcode' | 'sku' | 'none' = 'none';

      if (ean && ean !== 'SEM GTIN') {
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
      };
    });

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

    return { suggestedMatches, supplierId, supplierName };
  }
}
