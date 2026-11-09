import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { SaleReturnFiscalAction } from '../generated/tenant-client';
import { FiscalDocumentsService } from '../fiscal/fiscal-documents.service';
import { SaleReturnsService } from './sale-returns.service';

@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SaleReturnsController {
  constructor(
    private readonly returns: SaleReturnsService,
    private readonly fiscal: FiscalDocumentsService,
  ) {}

  @Get(':id/return-preview')
  @Roles('admin', 'manager', 'seller')
  preview(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.returns.preview(user.tenantSlug, id);
  }

  @Post(':id/returns')
  @Roles('admin', 'manager', 'seller')
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      permissionPassword?: string;
      refundMethod?: 'CASH' | 'CUSTOMER_CREDIT';
      notes?: string | null;
      items: Array<{ saleItemId: string; quantity: number }>;
      replacementItems?: Array<{ variantId: string; quantity: number; unitPrice: number }>;
      differenceMethod?: 'CASH' | 'PIX' | 'CARD' | 'REQUISITION' | 'OTHER';
    },
  ) {
    const created = await this.returns.create({
      tenantSlug: user.tenantSlug,
      userId: user.sub,
      userRoles: user.roles,
      permissionPassword: body.permissionPassword,
      saleId: id,
      refundMethod: body.refundMethod === 'CUSTOMER_CREDIT' ? 'CUSTOMER_CREDIT' : 'CASH',
      notes: body.notes,
      items: body.items ?? [],
      replacementItems: body.replacementItems,
      differenceMethod: body.differenceMethod,
    });

    let fiscalWarning: string | null = null;
    if (created.cancelFiscalDocumentId) {
      try {
        await this.fiscal.cancelById(
          user.tenantSlug,
          created.cancelFiscalDocumentId,
          user.sub,
          user.roles,
          body.permissionPassword,
          'Devolucao total da venda dentro do prazo de cancelamento.',
        );
        await this.returns.markFiscal(
          user.tenantSlug,
          created.return.id,
          SaleReturnFiscalAction.CANCELLED_ORIGINAL,
          'Nota original cancelada na SEFAZ.',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha ao cancelar a nota.';
        fiscalWarning = message;
        await this.returns.markFiscal(
          user.tenantSlug,
          created.return.id,
          SaleReturnFiscalAction.CANCEL_FAILED,
          message,
        );
      }
    }

    return {
      ...created.return,
      replacementSale: created.replacementSale,
      replacementError: created.replacementError,
      fiscalWarning,
    };
  }
}
