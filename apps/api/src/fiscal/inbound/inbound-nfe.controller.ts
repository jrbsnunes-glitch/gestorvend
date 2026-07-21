import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InboundNfeStatus } from '../../generated/tenant-client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { JwtPayload } from '../../auth/strategies/jwt.strategy';
import { InboundNfeService } from './inbound-nfe.service';

const XML_UPLOAD_LIMIT = 5 * 1024 * 1024;

@Controller('fiscal/inbound')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InboundNfeController {
  constructor(private readonly inbound: InboundNfeService) {}

  /** Verifica se a chave já foi importada (sem chamar SEFAZ). */
  @Get('check-key/:accessKey')
  @Roles('admin', 'manager', 'finance')
  async checkKey(@CurrentUser() user: JwtPayload, @Param('accessKey') accessKey: string) {
    const duplicate = await this.inbound.checkDuplicate(user.tenantSlug, accessKey);
    return { duplicate: Boolean(duplicate), existing: duplicate };
  }

  /** Caixa de entrada: NF-e baixadas / pendentes de revisão. */
  @Get('documents')
  @Roles('admin', 'manager', 'finance')
  async listDocuments(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
  ) {
    const statusEnum =
      status && Object.values(InboundNfeStatus).includes(status as InboundNfeStatus)
        ? (status as InboundNfeStatus)
        : undefined;
    return this.inbound.listDocuments(user.tenantSlug, { status: statusEnum });
  }

  /** Preview + matches de um documento da caixa de entrada (completa XML se necessário). */
  @Get('documents/:accessKey')
  @Roles('admin', 'manager', 'finance')
  async getDocument(@CurrentUser() user: JwtPayload, @Param('accessKey') accessKey: string) {
    return this.inbound.getDocumentPreview(user.tenantSlug, accessKey);
  }

  /** Baixa XML na SEFAZ (ou reutiliza cache) e devolve preview para preencher a entrada. */
  @Post('fetch-by-key')
  @Roles('admin', 'manager')
  async fetchByKey(
    @CurrentUser() user: JwtPayload,
    @Body() body: { accessKey?: string },
  ) {
    return this.inbound.fetchByKey(user.tenantSlug, body.accessKey ?? '');
  }

  /**
   * Diagnóstico WS vs Portal: ambiente, CNPJ do certificado, NSU e dicas (cStat 137).
   * Query opcional `accessKey` para analisar a chave informada.
   */
  @Get('diagnostics')
  @Roles('admin', 'manager', 'finance')
  async diagnostics(
    @CurrentUser() user: JwtPayload,
    @Query('accessKey') accessKey?: string,
  ) {
    return this.inbound.getDiagnostics(user.tenantSlug, accessKey);
  }

  /**
   * Manifestação do destinatário:
   * 210200 Confirmação · 210210 Ciência · 210220 Desconhecimento · 210240 Não realizada.
   */
  @Post('manifest')
  @Roles('admin', 'manager')
  async manifest(
    @CurrentUser() user: JwtPayload,
    @Body() body: { accessKey?: string; tpEvento?: string; xJust?: string },
  ) {
    if (!body.accessKey?.trim() || !body.tpEvento?.trim()) {
      throw new BadRequestException('Informe accessKey e tpEvento.');
    }
    return this.inbound.registerManifestacao(user.tenantSlug, {
      accessKey: body.accessKey,
      tpEvento: body.tpEvento,
      xJust: body.xJust,
    });
  }

  /** Reprocessa um NSU pontual (consNSU) — útil para docs em RESUMO. */
  @Post('reprocess-nsu')
  @Roles('admin', 'manager')
  async reprocessNsu(
    @CurrentUser() user: JwtPayload,
    @Body() body: { nsu?: string },
  ) {
    return this.inbound.reprocessNsu(user.tenantSlug, body.nsu ?? '');
  }

  /**
   * Importa XML completo baixado no Portal Nacional (sem consulta SEFAZ).
   * Multipart campo `file` (.xml).
   */
  @Post('import-xml')
  @Roles('admin', 'manager')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: XML_UPLOAD_LIMIT },
    }),
  )
  async importXml(
    @CurrentUser() user: JwtPayload,
    @UploadedFile()
    file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie o arquivo XML da NF-e.');
    }
    const name = (file.originalname ?? '').toLowerCase();
    if (name && !name.endsWith('.xml')) {
      throw new BadRequestException('Envie um arquivo .xml');
    }
    const xml = file.buffer.toString('utf8');
    return this.inbound.importXml(user.tenantSlug, xml);
  }

  /** Dispara polling NSU sob demanda (além do job agendado). */
  @Post('poll-nsu')
  @Roles('admin', 'manager')
  async pollNsu(@CurrentUser() user: JwtPayload) {
    return this.inbound.pollDistNsu(user.tenantSlug);
  }
}
