import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { StockInventoryService } from './stock-inventory.service';

@Controller('stock-inventories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockInventoryController {
  constructor(private readonly inventories: StockInventoryService) {}

  @Get()
  @Roles('admin', 'manager', 'seller')
  list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.inventories.list(user.tenantSlug, status);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.inventories.get(user.tenantSlug, id);
  }

  @Post()
  @Roles('admin', 'manager')
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { locationId?: string; notes?: string | null },
  ) {
    return this.inventories.create(user.tenantSlug, user.sub, body);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  updateHeader(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { notes?: string | null },
  ) {
    return this.inventories.updateHeader(user.tenantSlug, id, body);
  }

  @Post(':id/items')
  @Roles('admin', 'manager')
  addItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      variantId?: string;
      countedQty?: string | number | null;
      notes?: string | null;
    },
  ) {
    return this.inventories.addItem(user.tenantSlug, id, body);
  }

  @Patch(':id/items/:itemId')
  @Roles('admin', 'manager')
  updateItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { countedQty?: string | number | null; notes?: string | null },
  ) {
    return this.inventories.updateItem(user.tenantSlug, id, itemId, body);
  }

  @Delete(':id/items/:itemId')
  @Roles('admin', 'manager')
  removeItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.inventories.removeItem(user.tenantSlug, id, itemId);
  }

  @Post(':id/post')
  @Roles('admin', 'manager')
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.inventories.post(user.tenantSlug, id, user.sub);
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.inventories.cancel(user.tenantSlug, id);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.inventories.removeDraft(user.tenantSlug, id);
  }
}
