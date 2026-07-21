import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { TenantProvisioningStatus } from '../generated/central-client';
import {
  FiscalDocumentKind,
  FiscalDocumentStatus,
  FiscalSefazEnvironment,
  PaymentMethod,
  ActivityLogAction,
} from '../generated/tenant-client';
import { CentralPrismaService } from '../prisma/central-prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { buildNfceAccessKey } from './utils/nfe-access-key';
import { ufToCodIbge } from './utils/uf-ibge';
import { createMutualTlsAgentFromPfx, loadPfxMaterial } from './issuer/load-pfx';
import { OutboundNfeStorage } from './issuer/outbound-nfe.storage';
import {
  appendInfNFeSupl,
  buildNfceInfNFeXml,
  buildNfceQrUrl,
  paymentMethodToTPag,
  type DestInput,
  type NfceItemInput,
} from './issuer/nfce-xml.builder';
import { extractFirstDigestValueB64, signNfeSignatureSibling } from './issuer/sign-inf-nfe';
import {
  buildNfeProcXml,
  parseSefazAutorizacaoResponse,
  postNfceAutorizacaoLote,
} from './sefaz/nfce-autorizacao-soap';
import { FiscalIssuerSettingsService } from './fiscal-issuer-settings.service';

const DEFAULT_SEFAZ_NFCE_SOAP_HOM =
  'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const DEFAULT_SEFAZ_NFCE_SOAP_PROD =
  'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const DEFAULT_SEFAZ_NFE_SOAP_HOM =
  'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const DEFAULT_SEFAZ_NFE_SOAP_PROD =
  'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const DEFAULT_QR_BASE_HOMOLOG =
  'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx';

function allocateMoneyByWeights(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const cents = Math.round(Math.max(0, total) * 100);
  const wSum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (cents === 0 || wSum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) / wSum) * cents);
  const floors = raw.map((x) => Math.floor(x));
  let rem = cents - floors.reduce((s, x) => s + x, 0);
  const fracIdx = raw
    .map((x, i) => ({ i, f: x - floors[i]! }))
    .sort((a, b) => b.f - a.f);
  for (let k = 0; k < rem; k++) {
    floors[fracIdx[k % n]!.i]! += 1;
  }
  return floors.map((c) => c / 100);
}

/** Extrai campos da chave de acesso (44 dígitos). */
function parseAccessKey44(key: string): {
  aamm: string;
  serie: number;
  nNF: number;
  tpEmis: number;
  cNF: string;
} | null {
  const k = key.replace(/\D/g, '');
  if (k.length !== 44) return null;
  return {
    aamm: k.slice(2, 6),
    serie: Number(k.slice(22, 25)),
    nNF: Number(k.slice(25, 34)),
    tpEmis: Number(k.slice(34, 35)) || 1,
    cNF: k.slice(35, 43),
  };
}

function wrapEnviNFe(nfeOrEnviXml: string): string {
  const trimmed = nfeOrEnviXml.trim();
  if (/<enviNFe[\s>]/i.test(trimmed)) return trimmed;
  const nfeMatch = trimmed.match(/<NFe[\s\S]*?<\/NFe>/i)?.[0];
  if (!nfeMatch) {
    throw new Error('XML armazenado em contingência não contém <NFe> válido.');
  }
  return (
    `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<idLote>1</idLote><indSinc>1</indSinc>${nfeMatch}</enviNFe>`
  );
}

@Injectable()
export class FiscalEmissionProcessorService {
  private readonly log = new Logger(FiscalEmissionProcessorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly central: CentralPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly issuerSvc: FiscalIssuerSettingsService,
    private readonly activityLog: ActivityLogService,
    private readonly outboundStorage: OutboundNfeStorage,
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
      where: {
        status: { in: [FiscalDocumentStatus.QUEUED, FiscalDocumentStatus.CONTINGENCY] },
      },
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
          data: { status: FiscalDocumentStatus.ERROR, lastError: msg },
        });
        await db.sale.update({
          where: { id: doc.saleId },
          data: { fiscalIntegrationError: `Fiscal: ${msg}`.slice(0, 1024) },
        });
      }
    }
  }

  private logFiscalAuthorized(
    tenantSlug: string,
    sale: { number: number; userId: string | null },
    accessKey: string,
  ): void {
    if (!sale.userId) return;
    this.activityLog.record({
      tenantSlug,
      userId: sale.userId,
      action: ActivityLogAction.FISCAL_DOC,
      summary: `Gerou nota fiscal — venda #${sale.number}`,
      entityType: 'fiscal_document',
      entityRef: accessKey.slice(0, 44),
    });
  }

  private async processOneDocument(tenantSlug: string, docId: string): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.fiscalDocument.findUniqueOrThrow({ where: { id: docId } });
    if (
      doc.status !== FiscalDocumentStatus.QUEUED &&
      doc.status !== FiscalDocumentStatus.CONTINGENCY
    ) {
      return;
    }

    const isNfce = doc.kind === FiscalDocumentKind.NFC_E;
    const isNfe = doc.kind === FiscalDocumentKind.NF_E;
    if (!isNfce && !isNfe) {
      throw new Error(`Tipo de documento não suportado: ${doc.kind}`);
    }

    const reuseAccessKey =
      (doc.status === FiscalDocumentStatus.CONTINGENCY || doc.tpEmis > 1) &&
      doc.accessKey &&
      /^\d{44}$/.test(doc.accessKey)
        ? doc.accessKey
        : null;

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
        'Emissão suporta CRT=1 (Simples Nacional) nesta versão. Ajuste o cadastro do emissor.',
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
        'Certificado A1 obrigatório: caminho e senha do .pfx em Empresa → Emissor fiscal.',
      );
    }

    const cscId =
      settings.nfceCscId?.trim() || this.config.get<string>('FISCAL_NFCE_CSC_ID')?.trim() || '';
    const csc = settings.nfceCsc?.trim() || this.config.get<string>('FISCAL_NFCE_CSC')?.trim() || '';
    if (isNfce && this.transportMode() === 'soap' && (!cscId || !csc)) {
      throw new Error('NFC-e em modo SOAP exige CSC (ID e token) no emissor fiscal.');
    }

    const sale = await db.sale.findUniqueOrThrow({
      where: { id: doc.saleId },
      include: {
        customer: true,
        payments: true,
        items: {
          include: {
            variant: { include: { product: { include: { fiscalSituation: true } } } },
          },
        },
      },
    });

    if (isNfe) {
      const custDoc = (sale.customer?.document ?? '').replace(/\D/g, '');
      if (!sale.customer || (custDoc.length !== 11 && custDoc.length !== 14)) {
        throw new Error('NF-e (modelo 55) exige cliente identificado com CPF ou CNPJ válido.');
      }
    }

    const tpAmb: 1 | 2 =
      settings.sefazEnvironment === FiscalSefazEnvironment.PRODUCAO ? 1 : 2;
    const production = tpAmb === 1;
    const codUf = ufToCodIbge(settings.uf);
    const now = new Date();
    const modelo: 55 | 65 = isNfe ? 55 : 65;
    let serie = isNfe ? settings.nfeSerie : settings.nfceSerie;
    let tpEmis =
      reuseAccessKey || doc.tpEmis > 1 ? doc.tpEmis || 9 : 1;

    // Contingência: retransmite o XML já assinado (mesma chave), sem remontar.
    if (reuseAccessKey && this.transportMode() === 'soap') {
      const stored = await this.outboundStorage.readXml(tenantSlug, reuseAccessKey);
      if (stored && !/<nfeProc[\s>]/i.test(stored)) {
        const parsedKey = parseAccessKey44(reuseAccessKey)!;
        const soapUrl =
          this.config.get<string>(
            isNfce ? 'FISCAL_SEFAZ_NFCE_SOAP_URL' : 'FISCAL_SEFAZ_NFE_SOAP_URL',
          )?.trim() ||
          (isNfce
            ? production
              ? DEFAULT_SEFAZ_NFCE_SOAP_PROD
              : DEFAULT_SEFAZ_NFCE_SOAP_HOM
            : production
              ? DEFAULT_SEFAZ_NFE_SOAP_PROD
              : DEFAULT_SEFAZ_NFE_SOAP_HOM);
        await db.fiscalDocument.update({
          where: { id: doc.id },
          data: { status: FiscalDocumentStatus.SENT },
        });
        const agent = createMutualTlsAgentFromPfx(certPath, certPassword);
        const enviNFe = wrapEnviNFe(stored);
        const respXml = await postNfceAutorizacaoLote(soapUrl, enviNFe, agent);
        const parsed = parseSefazAutorizacaoResponse(respXml);
        if (parsed.ok) {
          const nfeOnly = stored.match(/<NFe[\s\S]*?<\/NFe>/i)?.[0] ?? stored;
          const nfeProc = parsed.protNFeXml
            ? buildNfeProcXml(nfeOnly, parsed.protNFeXml)
            : nfeOnly;
          const saved = await this.outboundStorage.saveXml(
            tenantSlug,
            parsed.accessKey || reuseAccessKey,
            nfeProc,
          );
          await db.$transaction(async (tx) => {
            await tx.fiscalIssuerSettings.update({
              where: { id: settings.id },
              data: isNfe
                ? { nfeLastNumber: parsedKey.nNF }
                : { nfceLastNumber: parsedKey.nNF },
            });
            await tx.fiscalDocument.update({
              where: { id: doc.id },
              data: {
                status: FiscalDocumentStatus.AUTHORIZED,
                accessKey: parsed.accessKey || reuseAccessKey,
                protocol: parsed.protocol ?? null,
                sefazEnvironment: settings.sefazEnvironment,
                tpEmis: parsedKey.tpEmis,
                xmlPath: saved.path,
                xmlSha256: saved.sha256,
                lastError: null,
              },
            });
            await tx.sale.update({
              where: { id: doc.saleId },
              data: { fiscalIntegrationError: null },
            });
          });
          this.logFiscalAuthorized(tenantSlug, sale, parsed.accessKey || reuseAccessKey);
          this.log.log(
            `${isNfce ? 'NFC-e' : 'NF-e'} contingência autorizada tenant=${tenantSlug} chave=${reuseAccessKey}`,
          );
          return;
        }
        const short = parsed.motive.slice(0, 2000);
        const isCommFail =
          /timeout|ECONN|socket|TLS|certificate|403|unavailable|indispon/i.test(short) ||
          parsed.cStat === '108' ||
          parsed.cStat === '109';
        if (isCommFail && isNfce) {
          await db.fiscalDocument.update({
            where: { id: doc.id },
            data: {
              status: FiscalDocumentStatus.CONTINGENCY,
              tpEmis: parsedKey.tpEmis || 9,
              lastError: `Contingência: ${short}`.slice(0, 2000),
            },
          });
          return;
        }
        await db.fiscalDocument.update({
          where: { id: doc.id },
          data: { status: FiscalDocumentStatus.REJECTED, lastError: short },
        });
        await db.sale.update({
          where: { id: doc.saleId },
          data: { fiscalIntegrationError: `SEFAZ: ${short}`.slice(0, 1024) },
        });
        return;
      }
    }

    let aamm =
      String(now.getFullYear()).slice(-2) + String(now.getMonth() + 1).padStart(2, '0');
    let cNF = String(Math.floor(10_000_000 + Math.random() * 89_999_999));

    // Reserva número só após sucesso — evita buracos sem inutilização.
    const curSettings = await db.fiscalIssuerSettings.findUniqueOrThrow({
      where: { id: settings.id },
    });
    let nextNumber = (isNfe ? curSettings.nfeLastNumber : curSettings.nfceLastNumber) + 1;

    const reused = reuseAccessKey ? parseAccessKey44(reuseAccessKey) : null;
    if (reused) {
      aamm = reused.aamm;
      serie = reused.serie;
      nextNumber = reused.nNF;
      tpEmis = reused.tpEmis || tpEmis;
      cNF = reused.cNF;
    }

    const chave44 =
      reuseAccessKey ??
      buildNfceAccessKey({
        codUf,
        aammEmissao: aamm,
        cnpj14: cnpj,
        serie3: serie,
        nNF9: nextNumber,
        tpEmis,
        codigoNumerico8: Number(cNF),
        modelo,
      });

    const vDescTotal = Math.max(0, Number(sale.discount ?? 0));
    const vOutroTotal = Math.max(0, Number(sale.surcharge ?? 0));
    const lineWeights = sale.items.map((it) => Math.max(0, Number(it.totalLine)));
    const descParts = allocateMoneyByWeights(vDescTotal, lineWeights);
    const outroParts = allocateMoneyByWeights(vOutroTotal, lineWeights);

    const itemsXml: NfceItemInput[] = sale.items.map((it, idx) => {
      const p = it.variant.product;
      const fs = p.fiscalSituation;
      const cfop = (fs?.cfopInternal ?? '5102').replace(/\D/g, '').padStart(4, '0').slice(-4);
      const ncm = (p.ncm ?? '00000000').replace(/\D/g, '').padStart(8, '0').slice(-8);
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
        vDesc: descParts[idx] ?? 0,
        vOutro: outroParts[idx] ?? 0,
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
    const zipDigits = (company.zip ?? '').replace(/\D/g, '').padStart(8, '0').slice(-8);
    const munEmit = settings.municipalityIbge.replace(/\D/g, '').padStart(7, '0');
    const xMun = company.city?.trim() || 'MUNICIPIO';
    const ufSig = settings.uf.trim().toUpperCase().slice(0, 2);
    const dhEmiIso = `${now.toISOString().slice(0, 19)}-03:00`;

    let dest: DestInput | undefined;
    if (sale.customer) {
      const custDoc = (sale.customer.document ?? '').replace(/\D/g, '');
      dest = {
        document: custDoc || null,
        xNome: sale.customer.name,
        email: sale.customer.email,
        indIEDest: '9',
        ender:
          sale.customer.city && sale.customer.state
            ? {
                xLgr: sale.customer.street?.trim() || 'NAO INFORMADO',
                nro: sale.customer.number?.trim() || 'S/N',
                xBairro: sale.customer.district?.trim() || 'CENTRO',
                cMun: munEmit,
                xMun: sale.customer.city.trim(),
                uf: sale.customer.state.trim().toUpperCase().slice(0, 2),
                cep: (sale.customer.zip ?? zipDigits).replace(/\D/g, '').padStart(8, '0').slice(-8),
              }
            : null,
      };
    }

    const { xmlNfeEnvelope, infNFeId } = buildNfceInfNFeXml({
      chave44,
      cNF,
      tpAmb,
      dhEmiIso,
      crt: settings.crt,
      codMunIbgeFg: munEmit,
      modelo,
      serie,
      nNF: nextNumber,
      tpEmis,
      dhContIso: tpEmis !== 1 ? dhEmiIso : null,
      xJustCont:
        tpEmis !== 1
          ? 'Falha de comunicacao com a SEFAZ no momento da emissao. Documento em contingencia.'
          : null,
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
      dest,
      items: itemsXml,
      totals: { vNF, vProd, vDesc: vDescTotal, vOutro: vOutroTotal },
      payments: payRows.length ? payRows : [{ tPag: '01', vPag: vNF }],
    });

    const { privateKeyPem, certificatePem } = loadPfxMaterial(certPath, certPassword);
    let signed = signNfeSignatureSibling(xmlNfeEnvelope, {
      infNFeId,
      privateKeyPem,
      certificatePem,
    });
    const digest = extractFirstDigestValueB64(signed);

    if (isNfce && cscId && csc) {
      const qrBase =
        this.config.get<string>('FISCAL_NFCE_QR_BASE_URL')?.trim() || DEFAULT_QR_BASE_HOMOLOG;
      const urlChave = this.config.get<string>('FISCAL_NFCE_URL_CHAVE')?.trim();
      const qrUrl = buildNfceQrUrl({
        qrBaseUrl: qrBase,
        chNFe: chave44,
        tpAmb,
        versaoQr: '100',
        cscId,
        csc,
        digestValueB64: digest,
      });
      signed = appendInfNFeSupl(signed, qrUrl, urlChave);
    }

    const enviNFe =
      `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
      `<idLote>1</idLote><indSinc>1</indSinc>${signed}</enviNFe>`;

    const mode = this.transportMode();
    const soapUrl =
      this.config.get<string>(isNfce ? 'FISCAL_SEFAZ_NFCE_SOAP_URL' : 'FISCAL_SEFAZ_NFE_SOAP_URL')?.trim() ||
      (isNfce
        ? production
          ? DEFAULT_SEFAZ_NFCE_SOAP_PROD
          : DEFAULT_SEFAZ_NFCE_SOAP_HOM
        : production
          ? DEFAULT_SEFAZ_NFE_SOAP_PROD
          : DEFAULT_SEFAZ_NFE_SOAP_HOM);

    const persistAuthorized = async (accessKey: string, protocol: string | null, xmlToSave: string) => {
      const saved = await this.outboundStorage.saveXml(tenantSlug, accessKey, xmlToSave);
      await db.$transaction(async (tx) => {
        await tx.fiscalIssuerSettings.update({
          where: { id: settings.id },
          data: isNfe ? { nfeLastNumber: nextNumber } : { nfceLastNumber: nextNumber },
        });
        await tx.fiscalDocument.update({
          where: { id: doc.id },
          data: {
            status: FiscalDocumentStatus.AUTHORIZED,
            accessKey,
            protocol,
            sefazEnvironment: settings.sefazEnvironment,
            tpEmis,
            xmlPath: saved.path,
            xmlSha256: saved.sha256,
            lastError: null,
          },
        });
        await tx.sale.update({
          where: { id: doc.saleId },
          data: { fiscalIntegrationError: null },
        });
      });
      this.logFiscalAuthorized(tenantSlug, sale, accessKey);
    };

    if (mode === 'dry-run') {
      const fakeProc = buildNfeProcXml(
        signed,
        `<protNFe versao="4.00"><infProt><tpAmb>${tpAmb}</tpAmb><verAplic>DRY</verAplic>` +
          `<chNFe>${chave44}</chNFe><dhRecbto>${dhEmiIso}</dhRecbto><nProt>DRYRUN${nextNumber}</nProt>` +
          `<digVal>dry</digVal><cStat>100</cStat><xMotivo>Autorizado dry-run</xMotivo></infProt></protNFe>`,
      );
      await persistAuthorized(chave44, 'DRY-RUN', fakeProc);
      this.log.log(`[dry-run] ${isNfce ? 'NFC-e' : 'NF-e'} simulada tenant=${tenantSlug} chave=${chave44}`);
      return;
    }

    await db.fiscalDocument.update({
      where: { id: doc.id },
      data: { status: FiscalDocumentStatus.SENT },
    });

    const agent = createMutualTlsAgentFromPfx(certPath, certPassword);
    const respXml = await postNfceAutorizacaoLote(soapUrl, enviNFe, agent);
    const parsed = parseSefazAutorizacaoResponse(respXml);

    if (parsed.ok) {
      const accessKey = parsed.accessKey || chave44;
      const nfeProc = parsed.protNFeXml
        ? buildNfeProcXml(signed, parsed.protNFeXml)
        : signed;
      await persistAuthorized(accessKey, parsed.protocol ?? null, nfeProc);
      this.log.log(
        `${isNfce ? 'NFC-e' : 'NF-e'} autorizada tenant=${tenantSlug} chave=${accessKey}`,
      );
      return;
    }

    const short = parsed.motive.slice(0, 2000);
    // Falha de comunicação: marca contingência para reenvio (mantém número não consumido).
    const isCommFail =
      /timeout|ECONN|socket|TLS|certificate|403|unavailable|indispon/i.test(short) ||
      parsed.cStat === '108' ||
      parsed.cStat === '109';

    if (isCommFail && isNfce) {
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: {
          status: FiscalDocumentStatus.CONTINGENCY,
          tpEmis: 9,
          accessKey: chave44,
          lastError: `Contingência: ${short}`.slice(0, 2000),
        },
      });
      await this.outboundStorage.saveXml(tenantSlug, chave44, signed);
      await db.sale.update({
        where: { id: doc.saleId },
        data: {
          fiscalIntegrationError: `Contingência NFC-e: reenvie pela tela Notas Fiscais. ${short}`.slice(
            0,
            1024,
          ),
        },
      });
      this.log.warn(`NFC-e em contingência tenant=${tenantSlug}: ${short}`);
      return;
    }

    await db.fiscalDocument.update({
      where: { id: doc.id },
      data: { status: FiscalDocumentStatus.REJECTED, lastError: short },
    });
    await db.sale.update({
      where: { id: doc.saleId },
      data: { fiscalIntegrationError: `SEFAZ: ${short}`.slice(0, 1024) },
    });
    this.log.warn(`Documento rejeitado tenant=${tenantSlug}: ${short}`);
  }
}
