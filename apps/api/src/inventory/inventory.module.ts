import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GoodsReceiptController } from './goods-receipt.controller';
import { GoodsReceiptService } from './goods-receipt.service';
import { LocationsController } from './locations.controller';
import { StockExitsController } from './stock-exits.controller';
import { StockExitsService } from './stock-exits.service';
import { StockInventoryController } from './stock-inventory.controller';
import { StockInventoryService } from './stock-inventory.service';
import { StockMovementsController } from './stock-movements.controller';
import { StockTransfersController } from './stock-transfers.controller';

@Module({
  imports: [UsersModule],
  controllers: [
    LocationsController,
    StockMovementsController,
    GoodsReceiptController,
    StockExitsController,
    StockTransfersController,
    StockInventoryController,
  ],
  providers: [GoodsReceiptService, StockInventoryService, StockExitsService],
  exports: [GoodsReceiptService],
})
export class InventoryModule {}
