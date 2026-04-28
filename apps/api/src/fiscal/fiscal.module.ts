import { Module } from '@nestjs/common';
import { FiscalController } from './fiscal.controller';

@Module({
  controllers: [FiscalController],
})
export class FiscalModule {}
