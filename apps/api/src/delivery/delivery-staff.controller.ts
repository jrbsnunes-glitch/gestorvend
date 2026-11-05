import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PlanCode } from '../generated/central-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlanGuard } from '../auth/guards/plan.guard';
import { RequiresPlan } from '../auth/plan.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { DeliveryService } from './delivery.service';

@Controller('restaurant/delivery')
@UseGuards(JwtAuthGuard, RolesGuard, PlanGuard)
@RequiresPlan(PlanCode.RESTAURANT)
export class DeliveryStaffController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('orders')
  @Roles('admin', 'manager', 'seller', 'waiter')
  list(@CurrentUser() user: JwtPayload) {
    return this.delivery.listStaffOrders(user.tenantSlug);
  }

  @Get('pending-count')
  @Roles('admin', 'manager', 'seller', 'waiter')
  pending(@CurrentUser() user: JwtPayload) {
    return this.delivery.pendingCounterCount(user.tenantSlug).then((count) => ({ count }));
  }

  @Post('orders/:id/accept')
  @Roles('admin', 'manager', 'seller', 'waiter')
  accept(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.delivery.acceptOrder(user.tenantSlug, id);
  }

  @Post('orders/:id/kitchen-print')
  @Roles('admin', 'manager', 'seller', 'waiter')
  kitchen(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.delivery.sendToKitchen(user.tenantSlug, id);
  }

  @Patch('orders/:id/status')
  @Roles('admin', 'manager', 'seller', 'waiter')
  status(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status?: 'OUT_FOR_DELIVERY' | 'READY_PICKUP' | 'PREPARING' | 'COMPLETED' },
  ) {
    const status = body?.status ?? 'PREPARING';
    return this.delivery.setStatus(user.tenantSlug, id, status);
  }
}
