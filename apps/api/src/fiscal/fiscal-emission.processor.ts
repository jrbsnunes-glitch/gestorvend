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
import { validateSaleItemsForFiscalEmission } from './fiscal-emission-validation';
import { resolveFiscalEmitTransport, type FiscalEmitTransport } from './fiscal-emit-transport';
import { buildNfceAccessKey } from './utils/nfe-access-key';
import { lookupIbgeByCep } from './utils/via-cep';
import { ufToCodIbge } from './utils/uf-ibge';
import { formatSefazDateTime } from '../common/iana-timezone.util';
import { timezoneFromBrazilUf } from '../common/br-uf-timezone.util';
import { createMutualTlsAgentFromPfx, loadPfxMaterial } from './issuer/load-pfx';
import { OutboundNfeStorage } from './issuer/outbound-nfe.storage';
import {
  appendInfNFeSupl,
  buildNfceInfNFeXml,
  buildNfceQrUrlAm,
  buildNfceQrUrlContingenciaV2,
  buildNfceQrUrlContingenciaV3,
  buildNfceQrUrlV3,
  refreshNfceContingencyQr,
  mapSalePaymentToNfcePag,
  type DestInput,
  type NfceItemInput,
} from './issuer/nfce-xml.builder';
import { homologFieldText } from './homolog-labels';
import { resolveSoftwareHouseRespTec } from './issuer/fiscal-resptec';
import { resolveSefazWebservices } from './sefaz/sefaz-endpoints';
import { extractFirstDigestValueB64, signNfeSignatureSibling } from './issuer/sign-inf-nfe';
import {
  buildNfeProcXml,
  parseSefazAutorizacaoResponse,
  postNfceAutorizacaoLote,
} from './sefaz/nfce-autorizacao-soap';
import {
  buildConsSitNFeXml,
  parseNfeConsultaProtocoloResponse,
  postNfeConsultaProtocolo,
} from './sefaz/nfe-consulta-protocolo.soap';
import { withIssuerEmitLock } from './fiscal-issuer-emit-lock';
import { FiscalIssuerSettingsService } from './fiscal-issuer-settings.service';
import type * as https from 'https';


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

/**
 * NF-e (55): indIEDest a partir da IE do cadastro do cliente.
 * 1 = contribuinte com IE; 2 = contribuinte isento (PJ, sem tag IE); 9 = não contribuinte.
 * NFC-e (65) aceita só 9 — não usar aqui.
 */
export function destIeFromCustomer(
  docDigits: string,
  ieRaw: string | null | undefined,
): { indIEDest: '1' | '2' | '9'; ie: string | null } {
  const ie = (ieRaw ?? '').trim().toUpperCase();
  if (!ie) return { indIEDest: '9', ie: null };
  if (ie === 'ISENTO') {
    return docDigits.length === 14 ? { indIEDest: '2', ie: null } : { indIEDest: '9', ie: null };
  }
  const digits = ie.replace(/\D/g, '');
  if (!digits) return { indIEDest: '9', ie: null };
  return { indIEDest: '1', ie: digits };
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

  private transportMode(sefazEnvironment?: string | null): FiscalEmitTransport {
    return resolveFiscalEmitTransport({
      envTransport: this.config.get<string>('FISCAL_EMIT_TRANSPORT'),
      sefazEnvironment,
    });
  }

  /** Emissão imediata (ex.: nota de teste homologação) — fora do ciclo do worker. */
  async processDocumentNow(tenantSlug: string, docId: string): Promise<void> {
    await this.processOneDocument(tenantSlug, docId);
  }

  private sefazWs(
    uf: string,
    production: boolean,
    model: 55 | 65,
  ) {
    const isNfce = model === 65;
    return resolveSefazWebservices({
      uf,
      production,
      model: isNfce ? '65' : '55',
      overrides: {
        autorizacao: this.config
          .get<string>(isNfce ? 'FISCAL_SEFAZ_NFCE_SOAP_URL' : 'FISCAL_SEFAZ_NFE_SOAP_URL')
          ?.trim(),
        consulta: this.config
          .get<string>(
            isNfce ? 'FISCAL_SEFAZ_NFCE_CONSULTA_URL' : 'FISCAL_SEFAZ_NFE_CONSULTA_URL',
          )
          ?.trim(),
      },
    });
  }

  private shouldAttemptConsultaRecovery(cStat: string | undefined, motive: string): boolean {
    if (cStat === '539' || cStat === '104' || cStat === '108' || cStat === '109') {
      return true;
    }
    return /timeout|ECONN|socket|TLS|certificate|403|unavailable|indispon|ETIMEDOUT|ENOTFOUND/i.test(
      motive,
    );
  }

  private async tryRecoverAuthorizationViaConsulta(params: {
    consultUrl: string;
    tpAmb: 1 | 2;
    chNFe: string;
    signedNfe: string;
    agent: https.Agent;
  }): Promise<{ accessKey: string; protocol: string | null; nfeProc: string } | null> {
    try {
      const consXml = buildConsSitNFeXml({ tpAmb: params.tpAmb, chNFe: params.chNFe });
      const respXml = await postNfeConsultaProtocolo(params.consultUrl, consXml, params.agent);
      const parsed = parseNfeConsultaProtocoloResponse(respXml);
      if (!parsed.ok) {
        return null;
      }
      const nfeProc = parsed.protNFeXml
        ? buildNfeProcXml(params.signedNfe, parsed.protNFeXml)
        : params.signedNfe;
      return {
        accessKey: parsed.accessKey,
        protocol: parsed.protocol ?? null,
        nfeProc,
      };
    } catch (e) {
      this.log.warn(`Consulta protocolo pós-emissão falhou: ${(e as Error).message?.slice(0, 300)}`);
      return null;
    }
  }

  private async processTenant(tenantSlug: string): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const now = new Date();
    const pending = await db.fiscalDocument.findMany({
      where: {
        OR: [
          { status: FiscalDocumentStatus.QUEUED },
          {
            status: FiscalDocumentStatus.CONTINGENCY,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }, { accessKey: null }],
          },
        ],
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

  /** QR on-line (tpEmis 1) ou de contingência offline (tpEmis 9). */
  private nfceQrUrl(input: {
    tpEmis: number;
    qrVersion: string;
    chave44: string;
    tpAmb: 1 | 2;
    dhEmiIso: string;
    vNF: number;
    signedXml: string;
    cscId: string;
    csc: string;
    qrBase: string;
  }): string {
    if (input.tpEmis !== 9) {
      return input.qrVersion === '300'
        ? buildNfceQrUrlV3({ chNFe: input.chave44, tpAmb: input.tpAmb, qrBaseUrl: input.qrBase })
        : buildNfceQrUrlAm({
            chNFe: input.chave44,
            tpAmb: input.tpAmb,
            cscId: input.cscId,
            csc: input.csc,
            qrBaseUrl: input.qrBase,
          });
    }
    const digest = extractFirstDigestValueB64(input.signedXml);
    if (!digest) {
      throw new Error('NFC-e em contingência sem DigestValue para o QR Code.');
    }
    if (input.qrVersion === '300') {
      return buildNfceQrUrlContingenciaV3({
        chNFe: input.chave44,
        tpAmb: input.tpAmb,
        dhEmiIso: input.dhEmiIso,
        vNF: input.vNF,
        digestValueB64: digest,
        qrBaseUrl: input.qrBase,
      });
    }
    return buildNfceQrUrlContingenciaV2({
      chNFe: input.chave44,
      tpAmb: input.tpAmb,
      dhEmiIso: input.dhEmiIso,
      vNF: input.vNF,
      digestValueB64: digest,
      cscId: input.cscId,
      csc: input.csc,
      qrBaseUrl: input.qrBase,
    });
  }

  /** Monta e grava o XML que seria enviado, sem transmitir à SEFAZ. */
  async materializeXml(
    tenantSlug: string,
    docId: string,
  ): Promise<{ name: string; xml: string }> {
    const saved = await this.processOneDocument(tenantSlug, docId, { exportOnly: true });
    if (!saved?.xml) throw new Error('Não foi possível montar o XML desta nota.');
    return saved;
  }

  private async processOneDocument(
    tenantSlug: string,
    docId: string,
    options?: { exportOnly?: boolean },
  ): Promise<{ name: string; xml: string } | void> {
    const exportOnly = options?.exportOnly === true;
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.fiscalDocument.findUniqueOrThrow({ where: { id: docId } });
    if (
      !exportOnly &&
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

    if (!exportOnly) {
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: { status: FiscalDocumentStatus.BUILDING_XML, lastError: null },
      });
    }

    let exportedXml: { name: string; xml: string } | null = null;

    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    if (!ensured) {
      throw new Error('Cadastre a empresa e o emissor fiscal antes da transmissão.');
    }
    const { company, settings } = ensured;

    await withIssuerEmitLock(db, settings.id, async () => {
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
    if (isNfce && this.transportMode(settings.sefazEnvironment) === 'soap' && (!cscId || !csc)) {
      throw new Error('NFC-e em modo SOAP exige CSC (ID e token) no emissor fiscal.');
    }

    const sale = await db.sale.findUniqueOrThrow({
      where: { id: doc.saleId },
      include: {
        customer: true,
        payments: { include: { paymentForm: { select: { name: true } } } },
        operationNature: true,
        items: {
          include: {
            variant: { include: { product: { include: { fiscalSituation: true } } } },
          },
        },
      },
    });

    validateSaleItemsForFiscalEmission(sale);

    if (settings.crt === 3) {
      for (const it of sale.items) {
        const fs = it.variant.product.fiscalSituation;
        if (!fs?.cstIcms?.trim()) {
          throw new Error(
            `Produto "${it.variant.product.name}" sem CST ICMS — obrigatório para CRT=3 (regime normal).`,
          );
        }
      }
    }

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
    // NFC-e já parada por schema (215/999) sem XML: monta o documento offline
    // (tpEmis 9) para imprimir, em vez de reenviar o XML que a SEFAZ recusou.
    if (
      !exportOnly &&
      isNfce &&
      !reuseAccessKey &&
      doc.status === FiscalDocumentStatus.CONTINGENCY &&
      (doc.tpEmis <= 1 || !doc.accessKey)
    ) {
      tpEmis = 9;
    }

    // Contingência: retransmite o XML já assinado (mesma chave), sem remontar.
    if (!exportOnly && reuseAccessKey && this.transportMode(settings.sefazEnvironment) === 'soap') {
      const stored = await this.outboundStorage.readXml(tenantSlug, reuseAccessKey);
      if (stored && !/<nfeProc[\s>]/i.test(stored)) {
        const parsedKey = parseAccessKey44(reuseAccessKey)!;
        const wsCont = this.sefazWs(settings.uf, production, modelo);
        const soapUrl = wsCont.autorizacao;
        await db.fiscalDocument.update({
          where: { id: doc.id },
          data: { status: FiscalDocumentStatus.SENT },
        });
        const agent = createMutualTlsAgentFromPfx(certPath, certPassword);
        let xmlToSend = stored;
        if (isNfce && parsedKey.tpEmis === 9 && (wsCont.nfceQrVersion ?? '200') !== '300') {
          const qrOverride = this.config.get<string>('FISCAL_NFCE_QR_BASE_URL')?.trim();
          const qrBase = qrOverride || wsCont.nfceQrConsultaBase || '';
          const refreshed = refreshNfceContingencyQr(stored, {
            tpAmb,
            cscId,
            csc,
            qrBaseUrl: qrBase,
          });
          if (refreshed !== stored) {
            xmlToSend = refreshed;
            const savedQr = await this.outboundStorage.saveXml(tenantSlug, reuseAccessKey, refreshed);
            await db.fiscalDocument.update({
              where: { id: doc.id },
              data: { xmlPath: savedQr.path, xmlSha256: savedQr.sha256 },
            });
          }
        }
        const enviNFe = wrapEnviNFe(xmlToSend);
        const consultUrl = wsCont.consulta;
        const nfeOnlyStored = xmlToSend.match(/<NFe[\s\S]*?<\/NFe>/i)?.[0] ?? xmlToSend;
        let respXml: string;
        try {
          respXml = await postNfceAutorizacaoLote(soapUrl, enviNFe, agent);
        } catch (postErr) {
          const recovered = await this.tryRecoverAuthorizationViaConsulta({
            consultUrl,
            tpAmb,
            chNFe: reuseAccessKey,
            signedNfe: nfeOnlyStored,
            agent,
          });
          if (recovered) {
            const saved = await this.outboundStorage.saveXml(
              tenantSlug,
              recovered.accessKey,
              recovered.nfeProc,
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
                  accessKey: recovered.accessKey,
                  protocol: recovered.protocol,
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
            this.logFiscalAuthorized(tenantSlug, sale, recovered.accessKey);
            this.log.log(
              `${isNfce ? 'NFC-e' : 'NF-e'} recuperada por consulta tenant=${tenantSlug} chave=${recovered.accessKey}`,
            );
            return;
          }
          throw postErr;
        }
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
        if (this.shouldAttemptConsultaRecovery(parsed.cStat, short)) {
          const recovered = await this.tryRecoverAuthorizationViaConsulta({
            consultUrl,
            tpAmb,
            chNFe: reuseAccessKey,
            signedNfe: nfeOnlyStored,
            agent,
          });
          if (recovered) {
            const saved = await this.outboundStorage.saveXml(
              tenantSlug,
              recovered.accessKey,
              recovered.nfeProc,
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
                  accessKey: recovered.accessKey,
                  protocol: recovered.protocol,
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
            this.logFiscalAuthorized(tenantSlug, sale, recovered.accessKey);
            this.log.log(
              `${isNfce ? 'NFC-e' : 'NF-e'} recuperada por consulta tenant=${tenantSlug} chave=${recovered.accessKey}`,
            );
            return;
          }
        }
        const isCommFail =
          /timeout|ECONN|socket|TLS|certificate|403|unavailable|indispon/i.test(short) ||
          parsed.cStat === '108' ||
          parsed.cStat === '109';
        const schemaHold = parsed.cStat === '215' || parsed.cStat === '999';
        let reuseMotive = short;
        let reuseRejectedPath: string | null = null;
        if (schemaHold) {
          const rejected = await this.outboundStorage.saveRejectedXml(
            tenantSlug,
            reuseAccessKey,
            stored,
          );
          reuseRejectedPath = rejected.path;
          reuseMotive = `${rejected.name} | ${short}`.slice(0, 2000);
          this.log.warn(`XML recusado pela SEFAZ gravado em ${rejected.path}`);
        }
        if ((isCommFail || schemaHold) && isNfce) {
          const keepPrintedCopy = !schemaHold || parsedKey.tpEmis === 9;
          await db.fiscalDocument.update({
            where: { id: doc.id },
            data: {
              status: FiscalDocumentStatus.CONTINGENCY,
              tpEmis: keepPrintedCopy ? parsedKey.tpEmis || 9 : 1,
              accessKey: keepPrintedCopy ? reuseAccessKey : null,
              ...(schemaHold && !keepPrintedCopy && reuseRejectedPath
                ? { xmlPath: reuseRejectedPath }
                : {}),
              nextAttemptAt: schemaHold ? new Date(Date.now() + 15 * 60 * 1000) : new Date(),
              lastError: `Contingência: ${schemaHold ? reuseMotive : short}`.slice(0, 2000),
            },
          });
          await db.sale.update({
            where: { id: doc.saleId },
            data: {
              fiscalIntegrationError: schemaHold
                ? `Contingência NFC-e: a SEFAZ recusou o XML (${parsed.cStat}). Nova tentativa automática em 15 minutos.`
                : `Contingência NFC-e: reenvie pela tela Notas Fiscais. ${short}`.slice(0, 1024),
            },
          });
          return;
        }
        await db.fiscalDocument.update({
          where: { id: doc.id },
          data: { status: FiscalDocumentStatus.REJECTED, lastError: schemaHold ? reuseMotive : short },
        });
        await db.sale.update({
          where: { id: doc.saleId },
          data: { fiscalIntegrationError: `SEFAZ: ${schemaHold ? reuseMotive : short}`.slice(0, 1024) },
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

    const vDescCupom = Math.max(0, Number(sale.discount ?? 0));
    const vOutroTotal =
      Math.max(0, Number(sale.surcharge ?? 0)) + Math.max(0, Number(sale.cardFeeSurcharge ?? 0));
    const vFreteTotal = Math.max(0, Number(sale.freightAmount ?? 0));
    const natureCfop = (sale.operationNature?.cfop ?? '').replace(/\D/g, '').slice(0, 4);
    const destUf = sale.customer?.state?.trim().toUpperCase().slice(0, 2) ?? '';
    const emitUf = settings.uf.trim().toUpperCase().slice(0, 2);
    const isInterstate = Boolean(destUf && destUf.length === 2 && destUf !== emitUf);
    const idDest = isInterstate ? 2 : 1;
    const dec = (v: unknown) => {
      const n = Number(String(v ?? 0));
      return Number.isFinite(n) ? n : 0;
    };
    // Pesos pelo valor bruto da linha (qty × unitPrice) — MOC: vProd bruto, vDesc explícito.
    const grossWeights = sale.items.map((it) =>
      Math.max(0, Number(it.quantity) * Number(it.unitPrice)),
    );
    const descParts = allocateMoneyByWeights(vDescCupom, grossWeights);
    const outroParts = allocateMoneyByWeights(vOutroTotal, grossWeights);

    const itemsXml: NfceItemInput[] = sale.items.map((it, idx) => {
      const p = it.variant.product;
      const fs = p.fiscalSituation;
      const cfopRaw =
        doc.finNFe === 4
          ? isInterstate
            ? '2202'
            : '1202'
          : isInterstate
            ? natureCfop || fs?.cfopInterstate || '6102'
            : natureCfop || fs?.cfopInternal || '5102';
      const cfop = cfopRaw.replace(/\D/g, '').padStart(4, '0').slice(-4);
      const ncm = (p.ncm ?? '00000000').replace(/\D/g, '').padStart(8, '0').slice(-8);
      const csosnRaw = (fs?.csosn ?? '102').replace(/\D/g, '');
      const csosn = csosnRaw.slice(-3).padStart(3, '0');
      const orig =
        (p.fiscalOrigin ?? fs?.fiscalOrigin ?? '0').replace(/\D/g, '').slice(0, 1) || '0';
      const qty = Number(it.quantity);
      const unit = Number(it.unitPrice);
      const itemDesc = Math.max(0, Number(it.discount ?? 0));
      const gross = Math.max(0, qty * unit);
      const vDesc = Math.max(0, itemDesc + (descParts[idx] ?? 0));
      return {
        nItem: idx + 1,
        sku: it.variant.sku,
        description: homologFieldText(p.name, tpAmb, 120),
        ncm,
        cfop,
        uCom: p.taxUnit?.trim() || 'UN',
        qCom: qty,
        vUnCom: unit,
        vProd: gross,
        vDesc,
        vOutro: outroParts[idx] ?? 0,
        orig,
        csosn,
        cstIcms: fs?.cstIcms ?? null,
        aliqIcms: dec(fs?.aliqIcms),
        modBcIcms: fs?.modBcIcms ?? '3',
        redBcIcms: dec(fs?.redBcIcms),
        cstPis: fs?.cstPis ?? '49',
        cstCofins: fs?.cstCofins ?? '49',
        aliqPis: dec(fs?.aliqPis),
        aliqCofins: dec(fs?.aliqCofins),
        cstIpi: fs?.cstIpi ?? null,
        aliqIpi: dec(fs?.aliqIpi),
        ipiEnquadramento: fs?.ipiEnquadramento ?? null,
        cest: p.cest ?? null,
        exTipi: p.exTipi ?? fs?.exTipi ?? null,
        codBeneficio: fs?.codBeneficio ?? null,
        ean: it.variant.barcode ?? p.defaultBarcode ?? null,
        cstIbsCbs: fs?.cstIbsCbs ?? null,
        cClassTrib: fs?.cClassTrib ?? null,
        ibsRate: dec(fs?.ibsTestRate),
        cbsRate: dec(fs?.cbsTestRate),
        aliqFcp: dec(fs?.aliqFcp),
      };
    });

    const payRows =
      doc.finNFe === 4
        ? [{ tPag: '90', vPag: Number(sale.total), indPag: 0 as const }]
        : sale.payments
            .filter((p) => p.method !== PaymentMethod.EXPENSE)
            .map((p) => {
              const row = mapSalePaymentToNfcePag({
                method: String(p.method),
                amount: p.amount,
                cardOperation: p.cardOperation,
                paymentFormName: p.paymentForm?.name ?? null,
              });
              return { tPag: row.tPag, vPag: row.vPag, xPag: row.xPag, indPag: row.indPag };
            });

    const vNF = Number(sale.total);
    const vProd = itemsXml.reduce((s, x) => s + x.vProd, 0);
    const zipDigits = (company.zip ?? '').replace(/\D/g, '').padStart(8, '0').slice(-8);
    const munEmit = settings.municipalityIbge.replace(/\D/g, '').padStart(7, '0');
    const xMun = company.city?.trim() || 'MUNICIPIO';
    const ufSig = settings.uf.trim().toUpperCase().slice(0, 2);
    const dhEmiIso = formatSefazDateTime(
      now,
      company.timezone || timezoneFromBrazilUf(ufSig),
    );

    let dest: DestInput | undefined;
    if (sale.customer) {
      const custDoc = (sale.customer.document ?? '').replace(/\D/g, '');
      let destMunIbge =
        (sale.customer.cityIbge ?? '').replace(/\D/g, '').padStart(7, '0').slice(-7) || '';
      if (!destMunIbge && sale.customer.zip) {
        destMunIbge = (await lookupIbgeByCep(sale.customer.zip)) ?? '';
      }
      if (!destMunIbge && sale.customer.city && sale.customer.state?.trim().toUpperCase() === ufSig) {
        destMunIbge = munEmit;
      }
      const dest55Ie = isNfe ? destIeFromCustomer(custDoc, sale.customer.ie) : null;
      dest = {
        document: custDoc || null,
        xNome: homologFieldText(sale.customer.name, tpAmb, 60),
        email: sale.customer.email,
        indIEDest: dest55Ie?.indIEDest ?? '9',
        ie: dest55Ie?.ie ?? null,
        ender: {
          xLgr: sale.customer.street?.trim() || company.address?.trim() || 'NAO INFORMADO',
          nro: sale.customer.number?.trim() || company.addressNumber?.trim() || 'S/N',
          xBairro: sale.customer.district?.trim() || company.district?.trim() || 'CENTRO',
          cMun: destMunIbge || munEmit,
          xMun: sale.customer.city?.trim() || xMun,
          uf: (sale.customer.state?.trim() || ufSig).toUpperCase().slice(0, 2),
          cep: (sale.customer.zip ?? zipDigits).replace(/\D/g, '').padStart(8, '0').slice(-8),
        },
      };
    } else if (!isNfe) {
      const counterDoc = (sale.consumerDocument ?? '').replace(/\D/g, '');
      if (counterDoc.length === 11 || counterDoc.length === 14) {
        dest = {
          document: counterDoc,
          xNome: homologFieldText('CONSUMIDOR', tpAmb, 60),
          indIEDest: '9',
        };
      }
    }

    const nfeBuildParams = {
      chave44,
      cNF,
      natOp:
        doc.finNFe === 4
          ? 'DEVOLUCAO DE MERCADORIA'
          : sale.operationNature?.description?.trim() || 'VENDA',
      tpAmb,
      dhEmiIso,
      crt: settings.crt,
      codMunIbgeFg: munEmit,
      modelo,
      serie,
      nNF: nextNumber,
      tpEmis,
      finNFe: (doc.finNFe === 4 ? 4 : 1) as 1 | 4,
      refAccessKey: doc.refAccessKey,
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
        nro: company.addressNumber?.trim() || 'S/N',
        xBairro: company.district?.trim() || 'CENTRO',
        cMun: munEmit,
        xMun,
        uf: ufSig,
        cep: zipDigits,
      },
      dest,
      respTec: (() => {
        const respTec = resolveSoftwareHouseRespTec(this.config);
        if (!respTec && this.transportMode(settings.sefazEnvironment) === 'soap') {
          throw new Error(
            'infRespTec deve ser da software house (não do emitente). Configure FISCAL_RESPTEC_CNPJ, FISCAL_RESPTEC_CONTATO, FISCAL_RESPTEC_EMAIL e FISCAL_RESPTEC_FONE no servidor. A SEFAZ/AM exige o grupo (cStat 972).',
          );
        }
        return respTec;
      })(),
      items: itemsXml,
      totals: {
        vNF,
        vProd,
        vDesc: itemsXml.reduce((s, x) => s + (x.vDesc ?? 0), 0),
        vOutro: vOutroTotal,
        vFrete: vFreteTotal,
      },
      payments: payRows.length ? payRows : [{ tPag: '01', vPag: vNF }],
      modFrete: sale.freightMod ?? 9,
      deliveryVehiclePlate: sale.deliveryVehiclePlate,
      deliveryDriverName: sale.deliveryDriverName,
      infCplExtra: sale.notes,
      idDest,
    };
    const { xmlNfeEnvelope, infNFeId } = buildNfceInfNFeXml(nfeBuildParams);

    const { privateKeyPem, certificatePem } = loadPfxMaterial(certPath, certPassword);
    let signed = signNfeSignatureSibling(xmlNfeEnvelope, {
      infNFeId,
      privateKeyPem,
      certificatePem,
    });
    const wsEmit = this.sefazWs(ufSig, production, modelo);
    const qrVersion = wsEmit.nfceQrVersion ?? '200';
    const qrOverride = this.config.get<string>('FISCAL_NFCE_QR_BASE_URL')?.trim();
    const qrBase =
      qrOverride ||
      wsEmit.nfceQrConsultaBase ||
      'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx';
    const urlChave =
      this.config.get<string>('FISCAL_NFCE_URL_CHAVE')?.trim() || wsEmit.nfceUrlChave || '';
    if (isNfce) {
      if (qrVersion !== '300' && (!cscId || !csc)) {
        throw new Error('NFC-e em QR v2 exige CSC (ID e token) no emissor fiscal.');
      }
      signed = appendInfNFeSupl(
        signed,
        this.nfceQrUrl({
          tpEmis,
          qrVersion,
          chave44,
          tpAmb,
          dhEmiIso,
          vNF,
          signedXml: signed,
          cscId,
          csc,
          qrBase,
        }),
        urlChave,
      );
    }

    if (exportOnly) {
      const rejected = await this.outboundStorage.saveRejectedXml(tenantSlug, chave44, signed);
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: { xmlPath: rejected.path },
      });
      exportedXml = { name: rejected.name, xml: signed };
      return;
    }

    let shortHint =
      doc.lastError?.replace(/^Contingência:\s*/i, '').trim() ||
      'SEFAZ recusou o XML. Documento emitido em contingencia para impressao.';

    const persistContingencyPrint = async (accessKey: string, xml: string, reserveNumber: boolean) => {
      const saved = await this.outboundStorage.saveXml(tenantSlug, accessKey, xml);
      await db.$transaction(async (tx) => {
        if (reserveNumber) {
          await tx.fiscalIssuerSettings.update({
            where: { id: settings.id },
            data: { nfceLastNumber: nextNumber },
          });
        }
        await tx.fiscalDocument.update({
          where: { id: doc.id },
          data: {
            status: FiscalDocumentStatus.CONTINGENCY,
            tpEmis: 9,
            accessKey,
            protocol: null,
            sefazEnvironment: settings.sefazEnvironment,
            xmlPath: saved.path,
            xmlSha256: saved.sha256,
            nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
            lastError: `Contingência: ${shortHint}`.slice(0, 2000),
          },
        });
        await tx.sale.update({
          where: { id: doc.saleId },
          data: {
            fiscalIntegrationError:
              'NFC-e emitida em contingência. Imprima o DANFE e reenvie depois pela tela Notas Fiscais.',
          },
        });
      });
      this.log.warn(`NFC-e em contingência (impressão) tenant=${tenantSlug} chave=${accessKey}`);
    };

    const sealOfflineContingency = async (motive: string) => {
      shortHint = motive;
      const contChave = buildNfceAccessKey({
        codUf,
        aammEmissao: aamm,
        cnpj14: cnpj,
        serie3: serie,
        nNF9: nextNumber,
        tpEmis: 9,
        codigoNumerico8: Number(cNF),
        modelo,
      });
      const built = buildNfceInfNFeXml({
        ...nfeBuildParams,
        chave44: contChave,
        tpEmis: 9,
        dhContIso: dhEmiIso,
        xJustCont:
          'Falha de comunicacao com a SEFAZ no momento da emissao. Documento em contingencia.',
      });
      let xml = signNfeSignatureSibling(built.xmlNfeEnvelope, {
        infNFeId: built.infNFeId,
        privateKeyPem,
        certificatePem,
      });
      xml = appendInfNFeSupl(
        xml,
        this.nfceQrUrl({
          tpEmis: 9,
          qrVersion,
          chave44: contChave,
          tpAmb,
          dhEmiIso,
          vNF,
          signedXml: xml,
          cscId,
          csc,
          qrBase,
        }),
        urlChave,
      );
      await persistContingencyPrint(contChave, xml, !reused);
    };

    const schemaParked =
      isNfce &&
      tpEmis === 9 &&
      !reuseAccessKey &&
      doc.status === FiscalDocumentStatus.CONTINGENCY &&
      /\b(215|999)\b/.test(doc.lastError ?? '');
    if (schemaParked) {
      await persistContingencyPrint(chave44, signed, !reused);
      return;
    }

    const enviNFe =
      `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
      `<idLote>1</idLote><indSinc>1</indSinc>${signed}</enviNFe>`;

    const mode = this.transportMode(settings.sefazEnvironment);
    const soapUrl = wsEmit.autorizacao;

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
    const consultUrl = wsEmit.consulta;
    let respXml: string;
    try {
      respXml = await postNfceAutorizacaoLote(soapUrl, enviNFe, agent);
    } catch (postErr) {
      const recovered = await this.tryRecoverAuthorizationViaConsulta({
        consultUrl,
        tpAmb,
        chNFe: chave44,
        signedNfe: signed,
        agent,
      });
      if (recovered) {
        await persistAuthorized(recovered.accessKey, recovered.protocol, recovered.nfeProc);
        this.log.log(
          `${isNfce ? 'NFC-e' : 'NF-e'} recuperada por consulta tenant=${tenantSlug} chave=${recovered.accessKey}`,
        );
        return;
      }
      const postMsg = (postErr as Error).message?.slice(0, 2000) ?? String(postErr);
      if (isNfce && /timeout|ECONN|socket|TLS|ETIMEDOUT|ENOTFOUND|403|unavailable|indispon/i.test(postMsg)) {
        await db.fiscalDocument.update({
          where: { id: doc.id },
          data: {
            status: FiscalDocumentStatus.CONTINGENCY,
            tpEmis: 9,
            accessKey: chave44,
            lastError: `Contingência: ${postMsg}`.slice(0, 2000),
          },
        });
        await this.outboundStorage.saveXml(tenantSlug, chave44, signed);
        await db.sale.update({
          where: { id: doc.saleId },
          data: {
            fiscalIntegrationError: `Contingência NFC-e: reenvie pela tela Notas Fiscais. ${postMsg}`.slice(
              0,
              1024,
            ),
          },
        });
        this.log.warn(`NFC-e em contingência tenant=${tenantSlug}: ${postMsg}`);
        return;
      }
      throw postErr;
    }
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

    const rawHint = parsed.rawSnippet?.replace(/\s+/g, ' ').trim().slice(0, 1400) ?? '';
    const short = (
      parsed.cStat === '999' || parsed.cStat === '215'
        ? `${parsed.motive}${rawHint ? ` | ${rawHint}` : ''}`
        : parsed.motive
    ).slice(0, 2000);
    if (this.shouldAttemptConsultaRecovery(parsed.cStat, short)) {
      const recovered = await this.tryRecoverAuthorizationViaConsulta({
        consultUrl,
        tpAmb,
        chNFe: chave44,
        signedNfe: signed,
        agent,
      });
      if (recovered) {
        await persistAuthorized(recovered.accessKey, recovered.protocol, recovered.nfeProc);
        this.log.log(
          `${isNfce ? 'NFC-e' : 'NF-e'} recuperada por consulta tenant=${tenantSlug} chave=${recovered.accessKey}`,
        );
        return;
      }
    }
    // Falha de comunicação: guarda o XML e reenvia a mesma chave.
    // 215/999 na emissão normal: monta outro XML em contingência (tpEmis 9) com
    // QR offline, para o DANFE sair agora. Se o XML já é tpEmis 9, conserva a chave.
    const isCommFail =
      /timeout|ECONN|socket|TLS|certificate|403|unavailable|indispon/i.test(short) ||
      parsed.cStat === '108' ||
      parsed.cStat === '109';
    const schemaHold = parsed.cStat === '215' || parsed.cStat === '999';
    let schemaMotive = short;
    if (schemaHold) {
      const rejected = await this.outboundStorage.saveRejectedXml(tenantSlug, chave44, signed);
      schemaMotive = `${rejected.name} | ${short}`.slice(0, 2000);
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: { xmlPath: rejected.path },
      });
      this.log.warn(`XML recusado pela SEFAZ gravado em ${rejected.path}`);
    }

    if ((isCommFail || schemaHold) && isNfce) {
      if (schemaHold && tpEmis !== 9) {
        await sealOfflineContingency(schemaMotive);
        return;
      }
      if (schemaHold) {
        shortHint = schemaMotive;
        await persistContingencyPrint(chave44, signed, !reused);
        return;
      }
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: {
          status: FiscalDocumentStatus.CONTINGENCY,
          tpEmis,
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
      data: { status: FiscalDocumentStatus.REJECTED, lastError: schemaHold ? schemaMotive : short },
    });
    await db.sale.update({
      where: { id: doc.saleId },
      data: { fiscalIntegrationError: `SEFAZ: ${schemaHold ? schemaMotive : short}`.slice(0, 1024) },
    });
    this.log.warn(`Documento rejeitado tenant=${tenantSlug}: ${short}`);
    });
    if (exportOnly) {
      if (!exportedXml) throw new Error('Não foi possível montar o XML desta nota.');
      return exportedXml;
    }
  }
}
