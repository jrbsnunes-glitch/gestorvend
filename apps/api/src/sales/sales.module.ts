import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CompanyModule } from '../company/company.module';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payments/payments.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { SaleReturnsService } from './sale-returns.service';

@Module({
  imports: [UsersModule, CompanyModule, CatalogModule, PaymentsModule],
  controllers: [SalesController],
  providers: [SalesService, SaleReturnsService],
  exports: [SalesService, SaleReturnsService],
})
export class SalesModule {}
