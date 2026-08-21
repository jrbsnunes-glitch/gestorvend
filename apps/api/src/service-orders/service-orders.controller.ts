import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantModuleAddon } from '../generated/central-client';
import { PaymentMethod } from '../generated/tenant-client';
import { CurrentUser } from '../auth/current-user.decorator';
import { ModuleGuard } from '../auth/guards/module.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresModule } from '../auth/module.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { MenuAccessService } from '../users/menu-access.service';
import {
  ServiceOrdersService,
  type CreateServiceOrderInput,
  type UpdateServiceOrderInput,
} from './service-orders.service';

@Controller('service-orders')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequiresModule(TenantModuleAddon.SERVICE_ORDER)
export class ServiceOrdersController {
  constructor(
    private readonly serviceOrders: ServiceOrdersService,
    private readonly menuAccess: MenuAccessService,
  ) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance', 'technician')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('customerId') customerId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('type') type?: string,
    @Query('take') take?: string,
  ) {
    return this.serviceOrders.list(user.tenantSlug, {
      status,
      from,
      to,
      customerId,
      assignedToId,
      type,
      take: take != null ? Number(take) : undefined,
    });
  }

  @Get('search')
  @Roles('admin', 'manager', 'seller', 'finance', 'technician')
  search(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    return this.serviceOrders.search(user.tenantSlug, q ?? '');
  }

  @Get('equipment')
  @Roles('admin', 'manager', 'seller', 'finance', 'technician')
  listEquipment(
    @CurrentUser() user: JwtPayload,
    @Query('customerId') customerId?: string,
  ) {
    return this.serviceOrders.listEquipment(user.tenantSlug, customerId);
  }

  /** Lista enxuta para atribuir técnico/responsável na OS. */
  @Get('assignees')
  @Roles('admin', 'manager', 'seller', 'finance', 'technician')
  listAssignees(@CurrentUser() user: JwtPayload) {
    return this.serviceOrders.listAssignees(user.tenantSlug);
  }

  @Post('equipment')
  @Roles('admin', 'manager', 'seller', 'technician')
  async createEquipment(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      customerId: string;
      label: string;
      equipmentType?: string | null;
      brand?: string | null;
      model?: string | null;
      serialNumber?: string | null;
      plateOrTag?: string | null;
      notes?: string | null;
      managerPassword?: string;
    },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'serviceOrders',
      'create',
      body.managerPassword,
    );
    return this.serviceOrders.createEquipment(user.tenantSlug, body);
  }

  @Patch('equipment/:id')
  @Roles('admin', 'manager', 'seller', 'technician')
  async updateEquipment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      label?: string;
      equipmentType?: string | null;
      brand?: string | null;
      model?: string | null;
      serialNumber?: string | null;
      plateOrTag?: string | null;
      notes?: string | null;
      active?: boolean;
      managerPassword?: string;
    },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'serviceOrders',
      'update',
      body.managerPassword,
    );
    return this.serviceOrders.updateEquipment(user.tenantSlug, id, body);
  }

  @Get('report/summary')
  @Roles('admin', 'manager', 'finance')
  summary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.serviceOrders.summaryReport(user.tenantSlug, { from, to });
  }

  @Get(':id/billing-preview')
  @Roles('admin', 'manager', 'seller', 'finance', 'technician')
  billingPreview(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.serviceOrders.billingPreview(user.tenantSlug, id);
  }

  @Get(':id/print-data')
  @Roles('admin', 'manager', 'seller', 'finance', 'technician')
  printData(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.serviceOrders.printData(user.tenantSlug, id);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance', 'technician')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.serviceOrders.detail(user.tenantSlug, id);
  }

  @Post()
  @Roles('admin', 'manager', 'seller', 'technician')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateServiceOrderInput & { managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'serviceOrders',
      'create',
      body.managerPassword,
    );
    return this.serviceOrders.create(user.tenantSlug, { sub: user.sub, roles: user.roles }, body);
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'seller', 'technician')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdateServiceOrderInput & { managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'serviceOrders',
      'update',
      body.managerPassword,
    );
    return this.serviceOrders.update(
      user.tenantSlug,
      { sub: user.sub, roles: user.roles },
      id,
      body,
    );
  }

  @Post(':id/status')
  @Roles('admin', 'manager', 'seller', 'technician')
  async changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: string; note?: string; managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'serviceOrders',
      'update',
      body.managerPassword,
    );
    return this.serviceOrders.changeStatus(
      user.tenantSlug,
      { sub: user.sub, roles: user.roles },
      id,
      body.status,
      body.note,
    );
  }

  @Post(':id/bill')
  @Roles('admin', 'manager', 'seller', 'technician')
  async bill(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      payments: Array<{
        method: PaymentMethod | string;
        amount: number | string;
        installments?: number;
        paymentFormId?: string | null;
        authCode?: string | null;
      }>;
      cashSessionId?: string | null;
      discount?: number | string;
      notes?: string | null;
      permissionPassword?: string;
      managerPassword?: string;
    },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'serviceOrders',
      'update',
      body.managerPassword,
    );
    return this.serviceOrders.bill(
      user.tenantSlug,
      { sub: user.sub, roles: user.roles },
      id,
      body,
    );
  }

  @Post(':id/link-sale')
  @Roles('admin', 'manager', 'seller', 'technician')
  async linkSale(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { saleId: string; managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'serviceOrders',
      'update',
      body.managerPassword,
    );
    return this.serviceOrders.linkSale(
      user.tenantSlug,
      { sub: user.sub, roles: user.roles },
      id,
      body.saleId,
    );
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager')
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { note?: string; managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'serviceOrders',
      'delete',
      body.managerPassword,
    );
    return this.serviceOrders.cancel(
      user.tenantSlug,
      { sub: user.sub, roles: user.roles },
      id,
      body.note,
    );
  }

  @Post(':id/items/:itemId/consume')
  @Roles('admin', 'manager', 'seller', 'technician')
  async consume(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { managerPassword?: string } = {},
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'serviceOrders',
      'update',
      body.managerPassword,
    );
    return this.serviceOrders.consumeItem(
      user.tenantSlug,
      { sub: user.sub, roles: user.roles },
      id,
      itemId,
    );
  }
}
