import { Module } from '@nestjs/common';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ModuleGuard } from '../auth/guards/module.guard';
import { CompanyModule } from '../company/company.module';
import { TenantModule } from '../tenant/tenant.module';
import { ManufacturingController } from './manufacturing.controller';
import { ManufacturingPublicController } from './manufacturing-public.controller';
import { ManufacturingService } from './manufacturing.service';
import { ManufacturingStockService } from './manufacturing-stock.service';

@Module({
  imports: [TenantModule, CompanyModule, ActivityLogsModule, CatalogModule],
  controllers: [ManufacturingController, ManufacturingPublicController],
  providers: [ManufacturingService, ManufacturingStockService, ModuleGuard],
  exports: [ManufacturingService],
})
export class ManufacturingModule {}
