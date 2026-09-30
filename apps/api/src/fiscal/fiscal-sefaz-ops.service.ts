import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FiscalDocumentKind,
  FiscalDocumentStatus,
  FiscalSefazEnvironment,
  PaymentMethod,
  SaleStatus,
} from '../generated/tenant-client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SalesService } from '../sales/sales.service';
import { FiscalEmissionProcessorService } from './fiscal-emission.processor';
import { FiscalIssuerSettingsService } from './fiscal-issuer-settings.service';
import { HOMOLOG_FISCAL_LABEL } from './homolog-labels';
import { createMutualTlsAgentFromPfx } from './issuer/load-pfx';
import { resolveSefazWebservices, sefazEnvironmentIsProduction } from './sefaz/sefaz-endpoints';
import {
  buildConsStatServXml,
  parseNfeStatusServicoResponse,
  postNfeStatusServico,
} from './sefaz/nfe-status-servico.soap';
import { ufToCodIbge } from './utils/uf-ibge';

const HOMOLOG_TEST_CUSTOMER_DOC = '00000000191';
const HOMOLOG_TEST_VARIANT_SKU = 'HOMOLOG-FISCAL-TEST';

@Injectable()
export class FiscalSefazOpsService {
  constructor(
    private readonly config: ConfigService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly issuerSvc: FiscalIssuerSettingsService,
    private readonly emission: FiscalEmissionProcessorService,
    private readonly sales: SalesService,
  ) {}

  private assertFiscalModuleEnabled(): void {
    if (this.config.get<string>('FISCAL_MODULE_ENABLED') !== 'true') {
      throw new ServiceUnavailableException(
        'Módulo fiscal desligado (`FISCAL_MODULE_ENABLED=true`).',
      );
    }
  }

  private assertSoapTransport(): void {
    const mode = (this.config.get<string>('FISCAL_EMIT_TRANSPORT') ?? 'dry-run').toLowerCase();
    if (mode !== 'soap') {
      throw new BadRequestException(
        'Emissão real exige `FISCAL_EMIT_TRANSPORT=soap` no servidor da API.',
      );
    }
  }

  private endpointOverrides(model: '55' | '65') {
    const isNfce = model === '65';
    return {
      autorizacao: (
        isNfce
          ? this.config.get<string>('FISCAL_SEFAZ_NFCE_SOAP_URL')
          : this.config.get<string>('FISCAL_SEFAZ_NFE_SOAP_URL')
      )?.trim(),
      consulta: (
        isNfce
          ? this.config.get<string>('FISCAL_SEFAZ_NFCE_CONSULTA_URL')
          : this.config.get<string>('FISCAL_SEFAZ_NFE_CONSULTA_URL')
      )?.trim(),
      status: this.config.get<string>('FISCAL_SEFAZ_STATUS_URL')?.trim() || undefined,
    };
  }

  async testSefazStatus(tenantSlug: string, model: '55' | '65' = '65') {
    this.assertFiscalModuleEnabled();
    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    if (!ensured) {
      throw new BadRequestException('Configure empresa e emissor fiscal antes de testar a SEFAZ.');
    }
    const { settings } = ensured;
    const certPath =
      (settings.certificatePath?.trim() ||
        this.config.get<string>('FISCAL_ISSUER_CERT_PATH')?.trim()) ??
      '';
    const certPassword =
      settings.certificatePassword?.trim() ||
      this.config.get<string>('FISCAL_ISSUER_CERT_PASSWORD')?.trim() ||
      '';
    if (!certPath || !certPassword) {
      throw new BadRequestException('Certificado A1 e senha são obrigatórios para consultar a SEFAZ.');
    }

    const production = sefazEnvironmentIsProduction(settings.sefazEnvironment);
    const tpAmb: 1 | 2 = production ? 1 : 2;
    const cUF = ufToCodIbge(settings.uf);
    const ws = resolveSefazWebservices({
      uf: settings.uf,
      production,
      model,
      overrides: this.endpointOverrides(model),
    });

    const consXml = buildConsStatServXml({ tpAmb, cUF });
    const agent = createMutualTlsAgentFromPfx(certPath, certPassword);

    try {
      const respXml = await postNfeStatusServico(ws.status, consXml, agent);
      const parsed = parseNfeStatusServicoResponse(respXml);
      return {
        ok: parsed.ok,
        cStat: 'cStat' in parsed ? parsed.cStat : undefined,
        message: parsed.message,
        uf: settings.uf.trim().toUpperCase(),
        model,
        environment: settings.sefazEnvironment,
        endpoint: ws.status,
        raw: respXml.slice(0, 800),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const tlsHint = /self-signed certificate|certificate chain|unable to verify/i.test(msg)
        ? ' No Linux, configure a cadeia ICP-Brasil (ex.: `FISCAL_TLS_EXTRA_CA`).'
        : '';
      throw new BadRequestException(
        `Não foi possível consultar o status do serviço SEFAZ: ${msg}.${tlsHint}`,
      );
    }
  }

  /** Cria venda mínima e transmite na SEFAZ (somente homologação). */
  async emitHomologationTest(user: JwtPayload, type: 'NFE' | 'NFCE' = 'NFCE') {
    this.assertFiscalModuleEnabled();
    this.assertSoapTransport();

    const tenantSlug = user.tenantSlug;
    const ensured = await this.issuerSvc.ensureForTenant(tenantSlug);
    if (!ensured) {
      throw new BadRequestException('Configure certificado e ambiente em Emissor fiscal.');
    }
    const { company, settings } = ensured;

    if (settings.sefazEnvironment !== FiscalSefazEnvironment.HOMOLOGACAO) {
      throw new BadRequestException('Nota de teste só com ambiente SEFAZ = homologação.');
    }
    if (
      !(settings.certificatePath?.trim() || this.config.get<string>('FISCAL_ISSUER_CERT_PATH')?.trim())
    ) {
      throw new BadRequestException('Envie o certificado A1 antes de emitir.');
    }
    const cscId =
      settings.nfceCscId?.trim() || this.config.get<string>('FISCAL_NFCE_CSC_ID')?.trim() || '';
    const csc =
      settings.nfceCsc?.trim() || this.config.get<string>('FISCAL_NFCE_CSC')?.trim() || '';
    if (type === 'NFCE' && (!cscId || !csc)) {
      throw new BadRequestException(
        'NFC-e de teste: informe ID CSC e token de homologação no emissor fiscal.',
      );
    }

    const cnpj = (company.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      throw new BadRequestException('CNPJ da empresa inválido para emissão fiscal.');
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);

    let customer = await db.customer.findFirst({
      where: { document: HOMOLOG_TEST_CUSTOMER_DOC },
    });
    if (!customer) {
      customer = await db.customer.create({
        data: {
          name: HOMOLOG_FISCAL_LABEL.slice(0, 120),
          document: HOMOLOG_TEST_CUSTOMER_DOC,
          state: company.state?.trim() || settings.uf || 'AM',
          city: company.city?.trim() || 'Manaus',
          street: company.address?.trim() || 'Rua Homologacao SEFAZ',
          number: company.addressNumber?.trim() || 'S/N',
          district: company.district?.trim() || 'Centro',
          zip: (company.zip ?? '69000000').replace(/\D/g, '').slice(0, 8),
        },
      });
    }

    let variant = await db.productVariant.findUnique({
      where: { sku: HOMOLOG_TEST_VARIANT_SKU },
      include: { product: { include: { fiscalSituation: true } } },
    });
    if (!variant) {
      const fiscalSituation =
        (await db.fiscalSituation.findFirst({
          where: { csosn: { not: null } },
          orderBy: { code: 'asc' },
        })) ??
        (await db.fiscalSituation.findFirst({ orderBy: { code: 'asc' } }));
      if (!fiscalSituation) {
        throw new BadRequestException(
          'Cadastre ao menos uma situação fiscal (CSOSN/CST) antes do teste de emissão.',
        );
      }
      const product = await db.product.create({
        data: {
          name: 'Item teste homologacao SEFAZ',
          ncm: '04072100',
          fiscalOrigin: '0',
          fiscalSituationId: fiscalSituation.id,
          taxUnit: 'UN',
        },
      });
      variant = await db.productVariant.create({
        data: {
          productId: product.id,
          sku: HOMOLOG_TEST_VARIANT_SKU,
          retailPrice: 1,
        },
        include: { product: { include: { fiscalSituation: true } } },
      });
    } else if (!variant.product.fiscalSituationId) {
      const fs = await db.fiscalSituation.findFirst({
        where: { csosn: { not: null } },
      });
      if (fs) {
        await db.product.update({
          where: { id: variant.productId },
          data: { fiscalSituationId: fs.id, ncm: variant.product.ncm ?? '04072100' },
        });
        variant = await db.productVariant.findUniqueOrThrow({
          where: { id: variant.id },
          include: { product: { include: { fiscalSituation: true } } },
        });
      }
    }

    const operationNature =
      (await db.operationNature.findFirst({
        where: { isActive: true, cfop: { startsWith: '5' } },
        orderBy: { code: 'asc' },
      })) ?? (await db.operationNature.findFirst({ where: { isActive: true } }));
    if (!operationNature) {
      throw new BadRequestException('Cadastre uma natureza de operação (CFOP) ativa.');
    }

    const unitPrice = 1;
    const sale = await this.sales.create({
      tenantSlug,
      userId: user.sub,
      userRoles: user.roles ?? [],
      customerId: type === 'NFE' ? customer.id : null,
      operationNatureId: operationNature.id,
      deductStock: false,
      items: [{ variantId: variant.id, quantity: 1, unitPrice, discount: 0 }],
      payments: [{ method: PaymentMethod.CASH, amount: unitPrice }],
    });

    if (sale.status !== SaleStatus.COMPLETED) {
      throw new BadRequestException('Venda de teste não foi concluída — verifique permissões/estoque.');
    }

    const kind = type === 'NFE' ? FiscalDocumentKind.NF_E : FiscalDocumentKind.NFC_E;
    const doc = await db.fiscalDocument.upsert({
      where: { saleId: sale.id },
      create: {
        saleId: sale.id,
        kind,
        status: FiscalDocumentStatus.QUEUED,
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
        tpEmis: 1,
      },
    });

    try {
      await this.emission.processDocumentNow(tenantSlug, doc.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.fiscalDocument.update({
        where: { id: doc.id },
        data: { status: FiscalDocumentStatus.ERROR, lastError: msg.slice(0, 2000) },
      });
      throw new BadRequestException(msg);
    }

    const refreshed = await db.fiscalDocument.findUnique({
      where: { id: doc.id },
      include: {
        sale: { select: { id: true, number: true } },
      },
    });
    if (!refreshed) throw new BadRequestException('Documento fiscal não encontrado após emissão.');

    if (refreshed.status !== FiscalDocumentStatus.AUTHORIZED) {
      throw new BadRequestException(
        refreshed.lastError?.trim() ||
          `Emissão não autorizada (status ${refreshed.status}).`,
      );
    }

    return {
      ok: true,
      document: refreshed,
      saleNumber: refreshed.sale.number,
      message: 'Nota de homologação autorizada pela SEFAZ.',
    };
  }
}
