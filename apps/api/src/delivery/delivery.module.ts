import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CompanyModule } from '../company/company.module';
import { PaymentsModule } from '../payments/payments.module';
import { PrintingModule } from '../printing/printing.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { SalesModule } from '../sales/sales.module';
import { TenantModule } from '../tenant/tenant.module';
import { PlanGuard } from '../auth/guards/plan.guard';
import { DeliveryPublicController } from './delivery-public.controller';
import { DeliveryStaffController } from './delivery-staff.controller';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [
    TenantModule,
    CompanyModule,
    SalesModule,
    RestaurantModule,
    PrintingModule,
    CatalogModule,
    PaymentsModule,
  ],
  controllers: [DeliveryPublicController, DeliveryStaffController],
  providers: [DeliveryService, PlanGuard],
  exports: [DeliveryService],
})
export class DeliveryModule {}
