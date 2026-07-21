import { Module } from '@nestjs/common';
import { GoodsReceiptController } from './goods-receipt.controller';
import { GoodsReceiptService } from './goods-receipt.service';
import { LocationsController } from './locations.controller';
import { StockExitsController } from './stock-exits.controller';
import { StockMovementsController } from './stock-movements.controller';
import { StockTransfersController } from './stock-transfers.controller';

@Module({
  controllers: [
    LocationsController,
    StockMovementsController,
    GoodsReceiptController,
    StockExitsController,
    StockTransfersController,
  ],
  providers: [GoodsReceiptService],
  exports: [GoodsReceiptService],
})
export class InventoryModule {}
