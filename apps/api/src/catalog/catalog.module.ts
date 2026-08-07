import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CategoriesController } from './categories.controller';
import { CustomerCreditService } from './customer-credit.service';
import { CustomerGroupsController } from './customer-groups.controller';
import { CustomersController } from './customers.controller';
import { FiscalCodesController } from './fiscal-codes.controller';
import { FiscalSituationsController } from './fiscal-situations.controller';
import { PaymentFormsController } from './payment-forms.controller';
import { CardTransactionsController } from './card-transactions.controller';
import { ProductsController } from './products.controller';
import { SuppliersController } from './suppliers.controller';
import { LookupsController } from './lookups.controller';
import { OperationNaturesController } from './operation-natures.controller';

@Module({
  imports: [UsersModule],
  controllers: [
    CustomersController,
    CustomerGroupsController,
    SuppliersController,
    CategoriesController,
    FiscalCodesController,
    FiscalSituationsController,
    OperationNaturesController,
    PaymentFormsController,
    CardTransactionsController,
    ProductsController,
    LookupsController,
  ],
  providers: [CustomerCreditService],
  exports: [CustomerCreditService],
})
export class CatalogModule {}
