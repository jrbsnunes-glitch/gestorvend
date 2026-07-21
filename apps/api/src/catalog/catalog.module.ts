import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CustomerGroupsController } from './customer-groups.controller';
import { CustomersController } from './customers.controller';
import { FiscalCodesController } from './fiscal-codes.controller';
import { FiscalSituationsController } from './fiscal-situations.controller';
import { PaymentFormsController } from './payment-forms.controller';
import { CardTransactionsController } from './card-transactions.controller';
import { ProductsController } from './products.controller';
import { SuppliersController } from './suppliers.controller';

@Module({
  controllers: [
    CustomersController,
    CustomerGroupsController,
    SuppliersController,
    CategoriesController,
    FiscalCodesController,
    FiscalSituationsController,
    PaymentFormsController,
    CardTransactionsController,
    ProductsController,
  ],
})
export class CatalogModule {}
