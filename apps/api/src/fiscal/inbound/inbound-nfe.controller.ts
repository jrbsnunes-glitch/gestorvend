import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InboundNfeStatus } from '../../generated/tenant-client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { JwtPayload } from '../../auth/strategies/jwt.strategy';
import { InboundNfeService } from './inbound-nfe.service';

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

  /** Dispara polling NSU sob demanda (além do job agendado). */
  @Post('poll-nsu')
  @Roles('admin', 'manager')
  async pollNsu(@CurrentUser() user: JwtPayload) {
    return this.inbound.pollDistNsu(user.tenantSlug);
  }
}
