import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { TenantProvisioningStatus } from '../generated/central-client';
import {
  FiscalDocumentKind,
  FiscalDocumentStatus,
  FiscalSefazEnvironment,
  PaymentMethod,
} from '../generated/tenant-client';
import { CentralPrismaService } from '../prisma/central-prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { buildNfceAccessKey } from './utils/nfe-access-key';
import { ufToCodIbge } from './utils/uf-ibge';
import { loadPfxMaterial } from './issuer/load-pfx';
import {
  appendInfNFeSupl,
  buildNfceInfNFeXml,
  buildNfceQrUrl,
  paymentMethodToTPag,
  type NfceItemInput,
} from './issuer/nfce-xml.builder';
import { extractFirstDigestValueB64, signNfeSignatureSibling } from './issuer/sign-inf-nfe';
import {
  parseSefazAutorizacaoResponse,
  postNfceAutorizacaoLote,
} from './sefaz/nfce-autorizacao-soap';
import { FiscalIssuerSettingsService } from './fiscal-issuer-settings.service';

const DEFAULT_SEFAZ_NFCE_SOAP =
  'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NfeAutorizacao4.asmx';
const DEFAULT_QR_BASE_HOMOLOG =
  'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx';

@Injectable()
export class FiscalEmissionProcessorService {
  private readonly log = new Logger(FiscalEmissionProcessorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly central: CentralPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly issuerSvc: FiscalIssuerSettingsService,
  ) {}

  @Interval(60_000)
  async processAllTenants(): Promise<void> {
    if (this.config.get<string>('FISCAL_MODULE_ENABLED') !== 'true') {
      return;
    }
    const tenants = await this.central.tenant.findMany({
      where: { provisioningStatus: TenantProvisioningStatus.READY },
      select: { slug: true },
    });
    for (const t of tenants) {
      try {
        await this.processTenant(t.slug);
      } catch (e) {
        this.log.warn(`Fiscal worker tenant ${t.slug}: ${(e as Error).message}`);
      }
    }
  }

  private transportMode(): 'dry-run' | 'soap' {
    const m = (this.config.get<string>('FISCAL_EMIT_TRANSPORT') ?? 'dry-run').toLowerCase();
    return m === 'soap' ? 'soap' : 'dry-run';
  }

  private async processTenant(tenantSlug: string): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const pending = await db.fiscalDocument.findMany({
      where: { status: FiscalDocumentStatus.QUEUED },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    for (const doc of pending) {
      try {
        await this.processOneDocument(tenantSlug, doc.id);
      } catch (e) {
        const msg = (e as Error).message?.slice(0, 2000) ?? String(e);
        this.log.warn(`Doc ${doc.id}: ${msg}`);
        await db.fiscalDocument.update({
          where: { id: doc.id },
          data: {
            status: FiscalDocumentStatus.ERROR,
            lastError: msg,
          },
        });
        await db.sale.update({
          where: { id: doc.saleId },
          data: { fiscalIntegrationError: `Fiscal: ${msg}`.slice(0, 1024) },
        });
      }
    }
  }

  private async processOneDocument(tenantSlug: string, docId: string): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.fiscalDocument.findUniqueOrThrow({ where: { id: docId } });
    if (doc.status !== FiscalDocumentStatus.QUEUED) return;

    if (doc.kind === FiscalDocumentKind.NF_E) {
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: {
          status: FiscalDocumentStatus.ERROR,
          lastError: 'NF-e modelo 55 ainda não processada por este worker (use NFC-e ou aguarde evolução).',
        },
      });
      await db.sale.update({
        where: { id: doc.saleId },
        data: {
          fiscalIntegrationError:
            'Fiscal: emissão NF-e (55) não implementada no worker — reenfileire como NFC-e ou ajuste manual.',
        },
      });
      return;
    }

    await db.fiscalDocument.update({
      where: { id: doc.id },
      data: { status: FiscalDocumentStatus.BUILDING_XML, lastError: null },
    });

    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    if (!ensured) {
      throw new Error('Cadastre a empresa e o emissor fiscal antes da transmissão.');
    }
    const { company, settings } = ensured;
    if (settings.crt !== 1) {
      throw new Error(
        'Worker NFC-e suporta apenas CRT=1 (Simples Nacional) nesta versão. Ajuste o cadastro do emissor.',
      );
    }

    const cnpj = company.cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14 || cnpj === '00000000000000') {
      throw new Error('CNPJ da empresa inválido para emissão fiscal.');
    }

    const certPath =
      (settings.certificatePath?.trim() || this.config.get<string>('FISCAL_ISSUER_CERT_PATH')?.trim()) ??
      '';
    const certPassword =
      settings.certificatePassword?.trim() ||
      this.config.get<string>('FISCAL_ISSUER_CERT_PASSWORD')?.trim() ||
      '';
    if (!certPath || !certPassword) {
      throw new Error(
        'Certificado A1: informe certificatePath no emissor da Empresa (ou FISCAL_ISSUER_CERT_PATH na API) e a senha do .pfx na Empresa ou FISCAL_ISSUER_CERT_PASSWORD no ambiente.',
      );
    }

    const cscId =
      settings.nfceCscId?.trim() || this.config.get<string>('FISCAL_NFCE_CSC_ID')?.trim() || '';
    const csc = settings.nfceCsc?.trim() || this.config.get<string>('FISCAL_NFCE_CSC')?.trim() || '';
    if (this.transportMode() === 'soap' && (!cscId || !csc)) {
      throw new Error(
        'Transmissão SOAP exige CSC (ID e segredo) no cadastro do emissor fiscal da Empresa ou FISCAL_NFCE_CSC_ID e FISCAL_NFCE_CSC no ambiente.',
      );
    }

    const sale = await db.sale.findUniqueOrThrow({
      where: { id: doc.saleId },
      include: {
        payments: true,
        items: {
          include: {
            variant: {
              include: {
                product: { include: { fiscalSituation: true } },
              },
            },
          },
        },
      },
    });

    const tpAmb: 1 | 2 =
      settings.sefazEnvironment === FiscalSefazEnvironment.PRODUCAO ? 1 : 2;

    const codUf = ufToCodIbge(settings.uf);
    const now = new Date();
    const aamm =
      String(now.getFullYear()).slice(-2) + String(now.getMonth() + 1).padStart(2, '0');
    const cNF = String(Math.floor(10_000_000 + Math.random() * 89_999_999));

    const { nextNumber } = await db.$transaction(async (tx) => {
      const cur = await tx.fiscalIssuerSettings.findUniqueOrThrow({
        where: { id: settings.id },
      });
      const nextNumber = cur.nfceLastNumber + 1;
      await tx.fiscalIssuerSettings.update({
        where: { id: settings.id },
        data: { nfceLastNumber: nextNumber },
      });
      return { nextNumber };
    });

    const chave44 = buildNfceAccessKey({
      codUf,
      aammEmissao: aamm,
      cnpj14: cnpj,
      serie3: settings.nfceSerie,
      nNF9: nextNumber,
      tpEmis: 1,
      codigoNumerico8: Number(cNF),
    });

    const itemsXml: NfceItemInput[] = sale.items.map((it, idx) => {
      const p = it.variant.product;
      const fs = p.fiscalSituation;
      const cfop = (fs?.cfopInternal ?? '5102').replace(/\D/g, '').padStart(4, '0').slice(-4);
      const ncm = (p.ncm ?? '99999999').replace(/\D/g, '').padStart(8, '0').slice(-8);
      const csosnRaw = (fs?.csosn ?? '102').replace(/\D/g, '');
      const csosn = csosnRaw.slice(-3).padStart(3, '0');
      const orig = (p.fiscalOrigin ?? '0').replace(/\D/g, '').slice(0, 1) || '0';
      const qty = Number(it.quantity);
      const line = Number(it.totalLine);
      const vUn = qty > 0 ? line / qty : line;
      return {
        nItem: idx + 1,
        sku: it.variant.sku,
        description: p.name,
        ncm,
        cfop,
        uCom: p.taxUnit?.trim() || 'UN',
        qCom: qty,
        vUnCom: vUn,
        vProd: line,
        orig,
        csosn,
      };
    });

    const payRows = sale.payments
      .filter((p) => p.method !== PaymentMethod.EXPENSE)
      .map((p) => ({
        tPag: paymentMethodToTPag(String(p.method)),
        vPag: Number(p.amount),
      }));

    const vNF = Number(sale.total);
    const vProd = itemsXml.reduce((s, x) => s + x.vProd, 0);
    const vDescTotal = Math.max(0, Number(sale.discount ?? 0));

    const zipDigits = (company.zip ?? '').replace(/\D/g, '').padStart(8, '0').slice(-8);
    const munEmit = settings.municipalityIbge.replace(/\D/g, '').padStart(7, '0');
    const xMun = company.city?.trim() || 'MUNICIPIO';
    const ufSig = settings.uf.trim().toUpperCase().slice(0, 2);

    const dhEmiIso = `${now.toISOString().slice(0, 19)}-03:00`;

    const { xmlNfeEnvelope, infNFeId } = buildNfceInfNFeXml({
      chave44,
      cNF,
      tpAmb,
      dhEmiIso,
      crt: settings.crt,
      codMunIbgeFg: munEmit,
      modelo: 65,
      serie: settings.nfceSerie,
      nNF: nextNumber,
      emit: {
        cnpj,
        ie: company.ie,
        xNome: company.legalName,
        xFant: company.tradeName,
        xLgr: company.address?.trim() || 'NAO INFORMADO',
        nro: 'S/N',
        xBairro: 'CENTRO',
        cMun: munEmit,
        xMun,
        uf: ufSig,
        cep: zipDigits,
      },
      items: itemsXml,
      totals: { vNF, vProd, vDesc: vDescTotal },
      payments: payRows.length ? payRows : [{ tPag: '01', vPag: vNF }],
    });

    const { privateKeyPem, certificatePem } = loadPfxMaterial(certPath, certPassword);
    let signed = signNfeSignatureSibling(xmlNfeEnvelope, {
      infNFeId,
      privateKeyPem,
      certificatePem,
    });
    const digest = extractFirstDigestValueB64(signed);

    if (cscId && csc) {
      const qrBase =
        this.config.get<string>('FISCAL_NFCE_QR_BASE_URL')?.trim() || DEFAULT_QR_BASE_HOMOLOG;
      const qrUrl = buildNfceQrUrl({
        qrBaseUrl: qrBase,
        chNFe: chave44,
        tpAmb,
        versaoQr: '100',
        cscId,
        csc,
        digestValueB64: digest,
      });
      signed = appendInfNFeSupl(signed, qrUrl);
    }

    const enviNFe = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>${signed}</enviNFe>`;

    const mode = this.transportMode();
    const soapUrl =
      this.config.get<string>('FISCAL_SEFAZ_NFCE_SOAP_URL')?.trim() || DEFAULT_SEFAZ_NFCE_SOAP;

    if (mode === 'dry-run') {
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: {
          status: FiscalDocumentStatus.AUTHORIZED,
          accessKey: chave44,
          protocol: 'DRY-RUN',
          sefazEnvironment: settings.sefazEnvironment,
          lastError: null,
        },
      });
      await db.sale.update({
        where: { id: doc.saleId },
        data: { fiscalIntegrationError: null },
      });
      this.log.log(`[dry-run] NFC-e simulada tenant=${tenantSlug} chave=${chave44}`);
      return;
    }

    await db.fiscalDocument.update({
      where: { id: doc.id },
      data: { status: FiscalDocumentStatus.SENT },
    });

    const respXml = await postNfceAutorizacaoLote(soapUrl, enviNFe);
    const parsed = parseSefazAutorizacaoResponse(respXml);
    if (parsed.ok) {
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: {
          status: FiscalDocumentStatus.AUTHORIZED,
          accessKey: parsed.accessKey ?? chave44,
          protocol: parsed.protocol ?? null,
          sefazEnvironment: settings.sefazEnvironment,
          lastError: null,
        },
      });
      await db.sale.update({
        where: { id: doc.saleId },
        data: { fiscalIntegrationError: null },
      });
      this.log.log(`NFC-e autorizada tenant=${tenantSlug} chave=${parsed.accessKey ?? chave44}`);
    } else {
      const short = parsed.motive.slice(0, 2000);
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: {
          status: FiscalDocumentStatus.REJECTED,
          lastError: short,
        },
      });
      await db.sale.update({
        where: { id: doc.saleId },
        data: { fiscalIntegrationError: `SEFAZ: ${short}`.slice(0, 1024) },
      });
      this.log.warn(`NFC-e rejeitada tenant=${tenantSlug}: ${short}`);
    }
  }
}
