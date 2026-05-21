import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PaymentMethod } from '../generated/tenant-client';
import { SalesService } from './sales.service';

@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  list(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string) {
    return this.sales.list(user.tenantSlug, from, to);
  }

  @Post()
  @Roles('admin', 'manager', 'seller')
  create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      customerId?: string | null;
      notes?: string | null;
      discount?: number;
      items: Array<{
        variantId: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
      }>;
      payments: Array<{
        method: PaymentMethod;
        amount: number;
        installments?: number;
      }>;
    },
  ) {
    return this.sales.create({
      tenantSlug: user.tenantSlug,
      userId: user.sub,
      customerId: body.customerId,
      notes: body.notes,
      discount: body.discount,
      items: body.items,
      payments: body.payments,
    });
  }

  @Post(':id/items/:itemId/remove')
  @Roles('admin', 'manager')
  removeSaleLine(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.sales.removeSaleItem(user.tenantSlug, id, itemId, user.sub);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sales.findById(user.tenantSlug, id);
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sales.cancel(user.tenantSlug, id, user.sub);
  }
}
