import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { FiscalDocumentKind } from '../generated/tenant-client';
import { FiscalDocumentsService } from './fiscal-documents.service';

@Controller('fiscal/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalDocumentsController {
  constructor(private readonly docs: FiscalDocumentsService) {}

  @Get('sale/:saleId')
  @Roles('admin', 'manager', 'seller', 'finance')
  getBySale(@CurrentUser() user: JwtPayload, @Param('saleId') saleId: string) {
    return this.docs.findBySaleId(user.tenantSlug, saleId);
  }

  /** Enfileira ou reenfileira tentativa de emissão (stub local até integração SEFAZ). */
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

  /** Cancela documento fiscal localmente (requer permissão + senha, exceto administrador). */
  @Post(':id/cancel')
  @Roles('admin', 'manager', 'seller')
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { permissionPassword?: string },
  ) {
    return this.docs.cancelById(
      user.tenantSlug,
      id,
      user.sub,
      user.roles,
      body?.permissionPassword,
    );
  }
}
