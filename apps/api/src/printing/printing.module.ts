import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { PrintAgentController } from './print-agent.controller';
import { PrintingController } from './printing.controller';
import { PrintingService } from './printing.service';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [PrintingController, PrintAgentController],
  providers: [PrintingService],
  exports: [PrintingService],
})
export class PrintingModule {}
