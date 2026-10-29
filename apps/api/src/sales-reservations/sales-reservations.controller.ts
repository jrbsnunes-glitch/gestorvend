import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TenantModuleAddon } from '../generated/central-client';
import { PaymentMethod } from '../generated/tenant-client';
import { CurrentUser } from '../auth/current-user.decorator';
import { ModuleGuard } from '../auth/guards/module.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresModule } from '../auth/module.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { SalesReservationsService } from './sales-reservations.service';

@Controller('sales-reservations')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequiresModule(TenantModuleAddon.SALES_RESERVATION)
export class SalesReservationsController {
  constructor(private readonly reservations: SalesReservationsService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.reservations.list(user.tenantSlug, status);
  }

  @Get(':id/receipt')
  @Roles('admin', 'manager', 'seller', 'finance')
  receipt(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reservations.receiptPayload(user.tenantSlug, id);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reservations.getOne(user.tenantSlug, id);
  }

  @Post()
  @Roles('admin', 'manager', 'seller')
  create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      customerId?: string | null;
      notes?: string | null;
      items: Array<{
        variantId: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
      }>;
      payments: Array<{
        method?: PaymentMethod;
        amount: number;
        installments?: number;
        paymentFormId?: string | null;
      }>;
    },
  ) {
    return this.reservations.create({
      tenantSlug: user.tenantSlug,
      userId: user.sub,
      userRoles: user.roles,
      customerId: body.customerId,
      notes: body.notes,
      items: body.items ?? [],
      payments: body.payments ?? [],
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'seller')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      customerId?: string | null;
      notes?: string | null;
      items: Array<{
        variantId: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
      }>;
      payments: Array<{
        method?: PaymentMethod;
        amount: number;
        installments?: number;
        paymentFormId?: string | null;
      }>;
    },
  ) {
    return this.reservations.update(id, {
      tenantSlug: user.tenantSlug,
      userId: user.sub,
      userRoles: user.roles,
      customerId: body.customerId,
      notes: body.notes,
      items: body.items ?? [],
      payments: body.payments ?? [],
    });
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager', 'seller')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reservations.cancel(user.tenantSlug, id, user.sub);
  }

  @Post(':id/confirm')
  @Roles('admin', 'manager', 'seller')
  confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { cashSessionId?: string },
  ) {
    return this.reservations.confirm(
      user.tenantSlug,
      id,
      user.sub,
      user.roles,
      String(body?.cashSessionId ?? ''),
    );
  }
}
