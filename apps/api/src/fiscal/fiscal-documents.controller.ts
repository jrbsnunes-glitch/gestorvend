import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { FiscalDocumentKind } from '../generated/tenant-client';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalManualNfeService } from './fiscal-manual-nfe.service';
import type { ManualNfeInput } from './manual-nfe.types';

@Controller('fiscal/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalDocumentsController {
  constructor(
    private readonly docs: FiscalDocumentsService,
    private readonly manualNfe: FiscalManualNfeService,
  ) {}

  /**
   * Listagem / filtro do módulo Notas Fiscais.
   * Query: kind, dateFrom, dateTo, controlMin, controlMax, customerId, customerSegment,
   * authorized=1, contingency=1, take, skip.
   */
  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('kind') kind?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('controlMin') controlMin?: string,
    @Query('controlMax') controlMax?: string,
    @Query('customerId') customerId?: string,
    @Query('customerSegment') customerSegment?: string,
    @Query('authorized') authorized?: string,
    @Query('contingency') contingency?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    const kindEnum =
      kind === 'NFC_E' || kind === 'NF_E' ? (kind as FiscalDocumentKind) : undefined;
    return this.docs.list(user.tenantSlug, {
      kind: kindEnum,
      dateFrom,
      dateTo,
      controlMin: controlMin != null && controlMin !== '' ? Number(controlMin) : null,
      controlMax: controlMax != null && controlMax !== '' ? Number(controlMax) : null,
      customerId,
      customerSegment,
      authorized: authorized === '1' || authorized === 'true',
      contingency: contingency === '1' || contingency === 'true',
      take: take != null ? Number(take) : 30,
      skip: skip != null ? Number(skip) : 0,
    });
  }

  /** Relatório de linhas (produto / categoria / CFOP) com os mesmos filtros da listagem. */
  @Get('report-lines')
  @Roles('admin', 'manager', 'seller', 'finance')
  reportLines(
    @CurrentUser() user: JwtPayload,
    @Query('kind') kind?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('controlMin') controlMin?: string,
    @Query('controlMax') controlMax?: string,
    @Query('customerId') customerId?: string,
    @Query('customerSegment') customerSegment?: string,
    @Query('authorized') authorized?: string,
    @Query('contingency') contingency?: string,
    @Query('productId') productId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('cfop') cfop?: string,
    @Query('take') take?: string,
  ) {
    const kindEnum =
      kind === 'NFC_E' || kind === 'NF_E' ? (kind as FiscalDocumentKind) : undefined;
    return this.docs.reportLines(user.tenantSlug, {
      kind: kindEnum,
      dateFrom,
      dateTo,
      controlMin: controlMin != null && controlMin !== '' ? Number(controlMin) : null,
      controlMax: controlMax != null && controlMax !== '' ? Number(controlMax) : null,
      customerId,
      customerSegment,
      authorized: authorized === '1' || authorized === 'true',
      contingency: contingency === '1' || contingency === 'true',
      productId,
      categoryId,
      cfop,
      take: take != null ? Number(take) : 200,
    });
  }

  @Get('sale/:saleId')
  @Roles('admin', 'manager', 'seller', 'finance')
  getBySale(@CurrentUser() user: JwtPayload, @Param('saleId') saleId: string) {
    return this.docs.findBySaleId(user.tenantSlug, saleId);
  }

  @Post('manual-nfe/preview')
  @Roles('admin', 'manager')
  previewManualNfe(@CurrentUser() user: JwtPayload, @Body() body: ManualNfeInput) {
    return this.manualNfe.previewManualNfe(user.tenantSlug, body);
  }

  @Post('manual-nfe')
  @Roles('admin', 'manager')
  createManualNfe(@CurrentUser() user: JwtPayload, @Body() body: ManualNfeInput) {
    return this.manualNfe.createManualNfe(user, body);
  }

  @Get(':id/manual-nfe')
  @Roles('admin', 'manager')
  getManualNfeDraft(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.manualNfe.getManualNfeDraft(user.tenantSlug, id);
  }

  @Patch(':id/manual-nfe')
  @Roles('admin', 'manager')
  updateManualNfe(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: ManualNfeInput,
  ) {
    return this.manualNfe.updateManualNfe(user, id, body);
  }

  @Get(':id/danfe')
  @Roles('admin', 'manager', 'seller', 'finance')
  danfe(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.docs.danfePayload(user.tenantSlug, id);
  }

  @Get(':id/consult')
  @Roles('admin', 'manager', 'seller', 'finance')
  consult(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.docs.consultStatus(user.tenantSlug, id);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  getById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.docs.getById(user.tenantSlug, id);
  }

  /** Enfileira emissão NFC-e (65) ou NF-e (55) para a venda. */
  @Post('queue')
  @Roles('admin', 'manager')
  queue(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: { saleId: string; kind?: FiscalDocumentKind },
  ) {
    const kind = body.kind ?? FiscalDocumentKind.NFC_E;
    return this.docs.queue(user.tenantSlug, body.saleId, kind);
  }

  /** Inutiliza faixa de numeração NFC-e/NF-e na SEFAZ (antes de rotas :id). */
  @Post('inutilizar')
  @Roles('admin', 'manager')
  inutilizar(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      kind?: 'NFC_E' | 'NF_E';
      serie?: number;
      nNFIni?: number;
      nNFFin?: number;
      xJust?: string;
      ano?: number;
    },
  ) {
    if (!body.serie || !body.nNFIni || !body.nNFFin || !body.xJust?.trim()) {
      throw new BadRequestException(
        'Informe serie, nNFIni, nNFFin e xJust (mín. 15 caracteres).',
      );
    }
    if (body.xJust.trim().length < 15) {
      throw new BadRequestException('xJust deve ter no mínimo 15 caracteres.');
    }
    return this.docs.inutilizarNumeracao(user.tenantSlug, {
      kind: body.kind === 'NF_E' ? 'NF_E' : 'NFC_E',
      serie: Number(body.serie),
      nNFIni: Number(body.nNFIni),
      nNFFin: Number(body.nNFFin),
      xJust: body.xJust,
      ano: body.ano,
    });
  }

  @Post(':id/send')
  @Roles('admin', 'manager')
  sendDraft(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.manualNfe.sendDraftDocument(user.tenantSlug, id);
  }

  @Post(':id/cce')
  @Roles('admin', 'manager')
  cce(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { text?: string },
  ) {
    return this.docs.correctionLetterById(user.tenantSlug, id, body.text ?? '');
  }

  @Post(':id/mark-contingency')
  @Roles('admin', 'manager')
  markContingency(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { tpEmis?: number },
  ) {
    return this.docs.markContingency(user.tenantSlug, id, body?.tpEmis ?? 9);
  }

  @Post(':id/send-contingency')
  @Roles('admin', 'manager')
  sendContingency(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.docs.queueContingencySend(user.tenantSlug, id);
  }

  /** Cancela documento fiscal (SEFAZ se autorizado; senão só local). */
  @Post(':id/cancel')
  @Roles('admin', 'manager', 'seller')
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { permissionPassword?: string; xJust?: string },
  ) {
    return this.docs.cancelById(
      user.tenantSlug,
      id,
      user.sub,
      user.roles,
      body?.permissionPassword,
      body?.xJust,
    );
  }

  /** Exclui NF ainda não enviada/autorizada e estorna a venda. */
  @Post(':id/delete-unsent')
  @Roles('admin', 'manager')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body?: { permissionPassword?: string },
  ) {
    return this.docs.deleteUnsent(
      user.tenantSlug,
      id,
      user.sub,
      user.roles,
      body?.permissionPassword,
    );
  }
}
