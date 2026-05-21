import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { AuthModule } from './auth/auth.module';
import { CashModule } from './cash/cash.module';
import { CatalogModule } from './catalog/catalog.module';
import { CompanyModule } from './company/company.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FinanceModule } from './finance/finance.module';
import { FinancialOverviewModule } from './financial-overview/financial-overview.module';
import { PortalModule } from './portal/portal.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { HealthController } from './health.controller';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { SalesModule } from './sales/sales.module';
import { TenantModule } from './tenant/tenant.module';
import { UsersModule } from './users/users.module';
import { WaChatModule } from './wachat/wachat.module';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), '../../.env'),
      ],
    }),
    PrismaModule,
    TenantModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    SalesModule,
    CashModule,
    FinanceModule,
    FinancialOverviewModule,
    ReportsModule,
    FiscalModule,
    CompanyModule,
    DashboardModule,
    PortalModule,
    UsersModule,
    WaChatModule,
    ActivityLogsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
