import { Module } from '@nestjs/common';
import { CustomerReportsService } from './customer-reports.service';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [ReportsController],
  providers: [CustomerReportsService],
})
export class ReportsModule {}
