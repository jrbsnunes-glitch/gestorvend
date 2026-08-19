import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { UsersModule } from '../users/users.module';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionsService } from './requisitions.service';

@Module({
  imports: [UsersModule, SalesModule],
  controllers: [RequisitionsController],
  providers: [RequisitionsService],
})
export class RequisitionsModule {}
