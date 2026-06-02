import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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

  /** Baixa XML na SEFAZ (ou reutiliza cache) e devolve preview para preencher a entrada. */
  @Post('fetch-by-key')
  @Roles('admin', 'manager')
  async fetchByKey(
    @CurrentUser() user: JwtPayload,
    @Body() body: { accessKey?: string },
  ) {
    return this.inbound.fetchByKey(user.tenantSlug, body.accessKey ?? '');
  }
}
