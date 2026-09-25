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
import { ManufacturingProjectStatus } from '../generated/tenant-client';
import { CurrentUser } from '../auth/current-user.decorator';
import { ModuleGuard } from '../auth/guards/module.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiresModule } from '../auth/module.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ProductRecipeService } from '../catalog/product-recipe.service';
import { ManufacturingService } from './manufacturing.service';
import { ManufacturingStockService } from './manufacturing-stock.service';

@Controller('manufacturing')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequiresModule(TenantModuleAddon.FACTORY)
export class ManufacturingController {
  constructor(
    private readonly manufacturing: ManufacturingService,
    private readonly stock: ManufacturingStockService,
    private readonly productRecipes: ProductRecipeService,
  ) {}

  @Get('projects')
  @Roles('admin', 'manager', 'seller', 'finance')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
  ) {
    return this.manufacturing.list(user.tenantSlug, {
      status,
      source,
      from,
      to,
      take: take != null ? Number(take) : undefined,
    });
  }

  @Get('projects/search')
  @Roles('admin', 'manager', 'seller', 'finance')
  search(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    return this.manufacturing.search(user.tenantSlug, q ?? '');
  }

  @Get('projects/schedule')
  @Roles('admin', 'manager', 'seller', 'finance')
  schedule(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.manufacturing.schedule(user.tenantSlug, from ?? '', to ?? '');
  }

  @Get('projects/:id')
  @Roles('admin', 'manager', 'seller', 'finance')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.manufacturing.detail(user.tenantSlug, id, user.sub);
  }

  @Post('projects')
  @Roles('admin', 'manager', 'seller')
  create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      customerId: string;
      finishedVariantId: string;
      quantity: number | string;
      title?: string | null;
      customerBrief?: string | null;
      technicalSpec?: string | null;
      promisedAt?: string | null;
      technicalResponsibleId?: string | null;
      commercialResponsibleId?: string | null;
    },
  ) {
    return this.manufacturing.create(user.tenantSlug, user, body);
  }

  @Patch('projects/:id')
  @Roles('admin', 'manager', 'seller')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.manufacturing.update(user.tenantSlug, id, body as any);
  }

  @Post('projects/:id/status')
  @Roles('admin', 'manager', 'seller')
  changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: ManufacturingProjectStatus; note?: string | null },
  ) {
    return this.manufacturing.changeStatus(
      user.tenantSlug,
      user,
      id,
      body.status,
      body.note,
    );
  }

  @Post('projects/:id/apontamentos')
  @Roles('admin', 'manager', 'seller')
  addApontamento(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    return this.manufacturing.addApontamento(user.tenantSlug, user, id, body.note);
  }

  @Post('projects/:id/bom-additional')
  @Roles('admin', 'manager', 'seller')
  addAdditionalBom(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      ingredientVariantId: string;
      quantity: number | string;
      reason?: string | null;
      issueNow?: boolean;
    },
  ) {
    return this.manufacturing.addAdditionalBom(user.tenantSlug, user, id, body);
  }

  @Post('projects/:id/bom/recalculate')
  @Roles('admin', 'manager', 'seller')
  recalculateBom(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.manufacturing.recalculateBom(user.tenantSlug, id);
  }

  @Post('projects/:id/material-issues')
  @Roles('admin', 'manager', 'seller')
  async manualIssue(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { bomLineId: string; quantity: number | string },
  ) {
    const q =
      typeof body.quantity === 'number'
        ? body.quantity
        : parseFloat(String(body.quantity).replace(',', '.'));
    await this.stock.manualIssue(user.tenantSlug, id, user.sub, body.bomLineId, q);
    return this.manufacturing.detail(user.tenantSlug, id);
  }

  @Get('assignees')
  @Roles('admin', 'manager', 'seller', 'finance')
  assignees(@CurrentUser() user: JwtPayload) {
    return this.manufacturing.listAssignees(user.tenantSlug);
  }

  @Get('alerts')
  @Roles('admin', 'manager', 'seller', 'finance')
  alerts(@CurrentUser() user: JwtPayload) {
    return this.manufacturing.operationalAlerts(user.tenantSlug);
  }

  @Get('mrp/suggestions')
  @Roles('admin', 'manager', 'seller', 'finance')
  mrpSuggestions(@CurrentUser() user: JwtPayload) {
    return this.manufacturing.mrpSuggestions(user.tenantSlug);
  }

  @Get('projects/:id/print-data')
  @Roles('admin', 'manager', 'seller', 'finance')
  printData(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.manufacturing.printData(user.tenantSlug, id);
  }

  @Patch('projects/:id/bom-lines/:lineId')
  @Roles('admin', 'manager', 'seller')
  updateBomLine(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: { scrapPct?: number | string; issueAtStart?: boolean },
  ) {
    return this.manufacturing.updateBomLine(user.tenantSlug, id, lineId, body);
  }

  @Post('projects/:id/link-deposit')
  @Roles('admin', 'manager', 'seller', 'finance')
  linkDeposit(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { saleId: string },
  ) {
    return this.manufacturing.linkDepositSale(user.tenantSlug, id, body.saleId);
  }

  @Get('recipes/:productId')
  @Roles('admin', 'manager')
  getRecipe(@CurrentUser() user: JwtPayload, @Param('productId') productId: string) {
    return this.productRecipes.getRecipe(user.tenantSlug, productId);
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
    return this.productRecipes.upsertRecipe(user.tenantSlug, productId, body);
  }
}
