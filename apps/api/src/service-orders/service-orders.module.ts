import { Module } from '@nestjs/common';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { ModuleGuard } from '../auth/guards/module.guard';
import { CompanyModule } from '../company/company.module';
import { SalesModule } from '../sales/sales.module';
import { TenantModule } from '../tenant/tenant.module';
import { UsersModule } from '../users/users.module';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersService } from './service-orders.service';

@Module({
  imports: [TenantModule, SalesModule, CompanyModule, UsersModule, ActivityLogsModule],
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersService, ModuleGuard],
  exports: [ServiceOrdersService],
})
export class ServiceOrdersModule {}
