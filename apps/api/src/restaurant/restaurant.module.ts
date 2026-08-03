import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { SalesModule } from '../sales/sales.module';
import { CompanyModule } from '../company/company.module';
import { PlanGuard } from '../auth/guards/plan.guard';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';

@Module({
  imports: [TenantModule, SalesModule, CompanyModule],
  controllers: [RestaurantController],
  providers: [RestaurantService, PlanGuard],
  exports: [RestaurantService],
})
export class RestaurantModule {}
