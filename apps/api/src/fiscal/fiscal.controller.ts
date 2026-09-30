import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { FiscalSefazOpsService } from './fiscal-sefaz-ops.service';

/**
 * Roadmap NF-e / NFC-e / SPED e reforma tributária (IBS/CBS).
 *
 * Etapa atual: infraestrutura de dados (`FiscalSituation`, `Sale.fiscalIntegrationError`,
 * modo de documento por empresa); integração SEFAZ atrás da flag `FISCAL_MODULE_ENABLED`.
 */
@Controller('fiscal')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalController {
  constructor(
    private readonly config: ConfigService,
    private readonly sefazOps: FiscalSefazOpsService,
  ) {}

  /** Consulta NfeStatusServico4 (certificado + UF emissor). */
  @Post('test-sefaz')
  @Roles('admin', 'manager')
  testSefaz(
    @CurrentUser() user: JwtPayload,
    @Query('model') model?: string,
  ) {
    const m = model === '55' || model === 'NFE' ? '55' : '65';
    return this.sefazOps.testSefazStatus(user.tenantSlug, m);
  }

  /** Venda mínima + transmissão imediata (somente ambiente homologação). */
  @Post('homolog-test-emit')
  @Roles('admin', 'manager')
  homologTestEmit(
    @CurrentUser() user: JwtPayload,
    @Query('type') type?: string,
    @Body() _body?: Record<string, unknown>,
  ) {
    const docType = type === 'NFE' || type === 'NF_E' ? 'NFE' : 'NFCE';
    return this.sefazOps.emitHomologationTest(user, docType);
  }

  @Get('status')
  @Roles('admin', 'manager')
  status() {
    const enabled = this.config.get<string>('FISCAL_MODULE_ENABLED') === 'true';
    if (!enabled) {
      throw new ServiceUnavailableException({
        message:
          'Módulo fiscal (SEFAZ) desligado. Ative `FISCAL_MODULE_ENABLED=true` quando o certificado e o ambiente estiverem prontos.',
        enabled: false,
      });
    }
    return {
      enabled: true,
      note:
        'Worker interno ~60s: A1 + CSC por tenant (Empresa / emissor) ou fallback `FISCAL_*` no servidor; `FISCAL_EMIT_TRANSPORT=dry-run|soap`, SOAP (`FISCAL_SEFAZ_NFCE_SOAP_URL`). API `GET|PATCH /fiscal/issuer-settings`.',
    };
  }

  /**
   * Resumo público ao operador/admin — sempre 200 para o PDV exibir modo da empresa sem erro 503.
   */
  @Get('overview')
  @Roles('admin', 'manager', 'seller')
  async overviewDoc() {
    const enabled = this.config.get<string>('FISCAL_MODULE_ENABLED') === 'true';
    return {
      fiscalModuleBackendEnabled: enabled,
      legalReferences: [
        {
          topic: 'Reforma tributária — estrutura geral (IBS estadual/municipal + CBS federal)',
          ref: 'LC 214/2025 e regulamentos correlatos',
          urls: ['https://www12.senado.leg.br/noticias/', 'https://www.gov.br/fazenda/pt-br/'],
        },
        {
          topic: 'Regulamentos CBS (RFB) e IBS (CGIBS) — regras comuns aos dois tributos',
          ref: 'Publicações Ministério da Fazenda / Comitê Gestor do IBS (2026)',
          urls: ['https://www.gov.br/fazenda/pt-br/assuntos/noticias/'],
        },
        {
          topic: 'Transição documental — destaque CBS/IBS em DFe (orientação período-teste)',
          ref: 'Ato conjunto RFB/CGIBS nº 1/2025 (conforme veiculação oficial da Receita e do CGIBS)',
          note:
            'Em 2026 o sistema usa alíquota de teste apenas para validação de layout: referência comum 0,9% CBS + 0,1% IBS sobre a base de cálculo — sem recolhimento cheio nessa fase. Atualize os percentuais “teste” em Cadastros gerais → Situação fiscal quando a norma evoluir.',
        },
      ],
      implementationPlan: [
        'Certificado A1 (caminho .pfx + senha) e CSC NFC-e graváveis por tenant em `/fiscal/issuer-settings`; variáveis `FISCAL_*` como fallback.',
        'Worker multi-tenant: NC-e modelo 65 (CRT 1), assinatura xml-crypto, QR + SOAP `NFeAutorizacao4` (dry-run disponível).',
        'Ambiente homologação → produção (`FiscalIssuerSettings.sefazEnvironment`) e URLs estaduais (SVRS pode ser substituído por estado).',
        'Refinar XML (CST/CRT mistos), contingência offline, NFC-e modelo rejeição fina nos retornos, NF-e modelo 55.',
        'SPED e escrituração conforme calendário legal.',
      ],
    };
  }
}
