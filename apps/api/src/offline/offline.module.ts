import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { OfflineController } from './offline.controller';
import { OfflineService } from './offline.service';

@Module({
  imports: [SalesModule],
  controllers: [OfflineController],
  providers: [OfflineService],
})
export class OfflineModule {}
