import { Module } from '@nestjs/common';
import { ModuleGuard } from '../auth/guards/module.guard';
import { CatalogModule } from '../catalog/catalog.module';
import { CompanyModule } from '../company/company.module';
import { SalesModule } from '../sales/sales.module';
import { TenantModule } from '../tenant/tenant.module';
import { SalesReservationsController } from './sales-reservations.controller';
import { SalesReservationsProcessor } from './sales-reservations.processor';
import { SalesReservationsService } from './sales-reservations.service';

@Module({
  imports: [TenantModule, SalesModule, CompanyModule, CatalogModule],
  controllers: [SalesReservationsController],
  providers: [SalesReservationsService, SalesReservationsProcessor, ModuleGuard],
  exports: [SalesReservationsService],
})
export class SalesReservationsModule {}
