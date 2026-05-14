import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { SalesModule } from '../sales/sales.module';
import { WaChatController } from './wachat.controller';
import { WaChatService } from './wachat.service';

@Module({
  imports: [TenantModule, SalesModule],
  controllers: [WaChatController],
  providers: [WaChatService],
})
export class WaChatModule {}
