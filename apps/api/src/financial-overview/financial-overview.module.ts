import { Module } from '@nestjs/common';
import { FinancialOverviewController } from './financial-overview.controller';

@Module({
  controllers: [FinancialOverviewController],
})
export class FinancialOverviewModule {}
