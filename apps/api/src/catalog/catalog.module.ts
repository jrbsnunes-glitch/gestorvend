import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CustomersController } from './customers.controller';
import { FiscalCodesController } from './fiscal-codes.controller';
import { FiscalSituationsController } from './fiscal-situations.controller';
import { ProductsController } from './products.controller';
import { SuppliersController } from './suppliers.controller';

@Module({
  controllers: [
    CustomersController,
    SuppliersController,
    CategoriesController,
    FiscalCodesController,
    FiscalSituationsController,
    ProductsController,
  ],
})
export class CatalogModule {}
