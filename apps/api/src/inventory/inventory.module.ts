import { Module } from '@nestjs/common';
import { GoodsReceiptController } from './goods-receipt.controller';
import { LocationsController } from './locations.controller';
import { StockExitsController } from './stock-exits.controller';
import { StockMovementsController } from './stock-movements.controller';

@Module({
  controllers: [
    LocationsController,
    StockMovementsController,
    GoodsReceiptController,
    StockExitsController,
  ],
})
export class InventoryModule {}
