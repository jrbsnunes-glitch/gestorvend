import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PlanCode } from '../generated/central-client';
import { PaymentMethod } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlanGuard } from '../auth/guards/plan.guard';
import { RequiresPlan } from '../auth/plan.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { RestaurantService } from './restaurant.service';

@Controller('restaurant')
@UseGuards(JwtAuthGuard, RolesGuard, PlanGuard)
@RequiresPlan(PlanCode.RESTAURANT)
export class RestaurantController {
  constructor(private readonly restaurant: RestaurantService) {}

  @Get('areas')
  @Roles('admin', 'manager', 'seller')
  listAreas(@CurrentUser() user: JwtPayload) {
    return this.restaurant.listAreas(user.tenantSlug);
  }

  @Post('areas')
  @Roles('admin', 'manager')
  createArea(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; sortOrder?: number },
  ) {
    return this.restaurant.createArea(user.tenantSlug, body);
  }

  @Post('tables')
  @Roles('admin', 'manager')
  createTable(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: { areaId: string; code: string; label?: string | null; capacity?: number | null },
  ) {
    return this.restaurant.createTable(user.tenantSlug, body);
  }

  @Get('tabs')
  @Roles('admin', 'manager', 'seller')
  listTabs(@CurrentUser() user: JwtPayload) {
    return this.restaurant.listOpenTabs(user.tenantSlug);
  }

  @Get('tabs/:id')
  @Roles('admin', 'manager', 'seller')
  getTab(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.restaurant.getTab(user.tenantSlug, id);
  }

  @Post('tabs')
  @Roles('admin', 'manager', 'seller')
  openTab(
    @CurrentUser() user: JwtPayload,
    @Body() body: { tableId?: string | null; customerId?: string | null; notes?: string | null },
  ) {
    return this.restaurant.openTab(user.tenantSlug, user.sub, body);
  }

  @Post('tabs/:id/items')
  @Roles('admin', 'manager', 'seller')
  addItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      variantId: string;
      quantity: number | string;
      unitPrice?: number | string;
      discount?: number | string;
      notes?: string | null;
      weightGross?: number | string | null;
      weightTare?: number | string | null;
      printSector?: string | null;
    },
  ) {
    return this.restaurant.addItem(user.tenantSlug, id, body);
  }

  @Post('tabs/:id/items/:itemId/cancel')
  @Roles('admin', 'manager', 'seller')
  cancelItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.restaurant.cancelItem(user.tenantSlug, id, itemId);
  }

  @Post('tabs/:id/cancel')
  @Roles('admin', 'manager')
  cancelTab(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.restaurant.cancelTab(user.tenantSlug, id);
  }

  @Post('tabs/:id/kitchen-print')
  @Roles('admin', 'manager', 'seller')
  kitchenPrint(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { itemIds?: string[] },
  ) {
    return this.restaurant.markKitchenPrinted(user.tenantSlug, id, body?.itemIds);
  }

  @Post('tabs/:id/close')
  @Roles('admin', 'manager', 'seller')
  closeTab(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      discount?: number | string;
      surcharge?: number | string;
      notes?: string | null;
      permissionPassword?: string;
      payments: Array<{
        method: PaymentMethod;
        amount: number | string;
        installments?: number;
        paymentFormId?: string | null;
        authCode?: string | null;
      }>;
    },
  ) {
    return this.restaurant.closeTab(user.tenantSlug, user.sub, user.roles, id, body);
  }

  @Get('recipes/:productId')
  @Roles('admin', 'manager')
  getRecipe(@CurrentUser() user: JwtPayload, @Param('productId') productId: string) {
    return this.restaurant.getRecipe(user.tenantSlug, productId);
  }

  @Patch('recipes/:productId')
  @Roles('admin', 'manager')
  upsertRecipe(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
    @Body()
    body: {
      notes?: string | null;
      items: Array<{ ingredientVariantId: string; quantity: number | string }>;
    },
  ) {
    return this.restaurant.upsertRecipe(user.tenantSlug, productId, body);
  }
}
