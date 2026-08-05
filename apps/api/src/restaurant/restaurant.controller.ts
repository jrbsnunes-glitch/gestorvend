import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
  @Roles('admin', 'manager', 'seller', 'waiter')
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
  @Roles('admin', 'manager', 'seller', 'waiter')
  listTabs(@CurrentUser() user: JwtPayload) {
    return this.restaurant.listOpenTabs(user.tenantSlug);
  }

  @Get('tabs/lookup')
  @Roles('admin', 'manager', 'seller', 'waiter')
  lookupTab(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    return this.restaurant.lookupOpenTab(user.tenantSlug, q ?? '');
  }

  @Get('tabs/:id')
  @Roles('admin', 'manager', 'seller', 'waiter')
  getTab(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.restaurant.getTab(user.tenantSlug, id);
  }

  @Post('tabs')
  @Roles('admin', 'manager', 'seller', 'waiter')
  openTab(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      tableId?: string | null;
      customerId?: string | null;
      customerName?: string | null;
      notes?: string | null;
      guestCount?: number;
    },
  ) {
    return this.restaurant.openTab(user.tenantSlug, user.sub, body);
  }

  @Patch('tabs/:id')
  @Roles('admin', 'manager', 'seller', 'waiter')
  patchTab(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      guestCount?: number;
      customerId?: string | null;
      customerName?: string | null;
      notes?: string | null;
    },
  ) {
    return this.restaurant.patchTab(user.tenantSlug, id, body);
  }

  @Post('tabs/:id/items')
  @Roles('admin', 'manager', 'seller', 'waiter')
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
    return this.restaurant.addItem(user.tenantSlug, user.sub, id, body);
  }

  @Post('tabs/:id/items/:itemId/cancel')
  @Roles('admin', 'manager', 'seller', 'waiter')
  cancelItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.restaurant.cancelItem(user.tenantSlug, user.sub, id, itemId);
  }

  @Post('tabs/:id/cancel')
  @Roles('admin', 'manager')
  cancelTab(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.restaurant.cancelTab(user.tenantSlug, user.sub, id);
  }

  @Post('tabs/:id/kitchen-print')
  @Roles('admin', 'manager', 'seller', 'waiter')
  kitchenPrint(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { itemIds?: string[] },
  ) {
    return this.restaurant.markKitchenPrinted(user.tenantSlug, id, body?.itemIds);
  }

  /** Fechar comanda / cobrar — garçom não fecha (caixa no PDV). */
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
      /** Quando informado, só vincula a venda do PDV (sem criar Sale). */
      saleId?: string;
      payments?: Array<{
        method: PaymentMethod;
        amount: number | string;
        installments?: number;
        paymentFormId?: string | null;
        authCode?: string | null;
      }>;
    },
  ) {
    if (body.saleId?.trim()) {
      return this.restaurant.closeTabWithSale(user.tenantSlug, id, body.saleId.trim());
    }
    if (!body.payments?.length) {
      throw new BadRequestException(
        'Informe saleId (fechamento via PDV) ou payments (legado).',
      );
    }
    return this.restaurant.closeTab(user.tenantSlug, user.sub, user.roles, id, {
      ...body,
      payments: body.payments,
    });
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
