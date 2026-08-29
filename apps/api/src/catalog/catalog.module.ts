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
import { CatalogProductImagesController } from './catalog-product-images.controller';
import { ProductImageStorage } from './product-image.storage';

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
    CatalogProductImagesController,
  ],
  providers: [CustomerCreditService, ProductImageStorage],
  exports: [CustomerCreditService, ProductImageStorage],
})
export class CatalogModule {}
