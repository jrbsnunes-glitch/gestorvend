import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CustomersController } from './customers.controller';
import { FiscalCodesController } from './fiscal-codes.controller';
import { ProductsController } from './products.controller';
import { SuppliersController } from './suppliers.controller';

@Module({
  controllers: [
    CustomersController,
    SuppliersController,
    CategoriesController,
    FiscalCodesController,
    ProductsController,
  ],
})
export class CatalogModule {}
