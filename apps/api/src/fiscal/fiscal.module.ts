import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { FiscalDocumentsController } from './fiscal-documents.controller';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalEmissionProcessorService } from './fiscal-emission.processor';
import { FiscalIssuerSettingsController } from './fiscal-issuer-settings.controller';
import { FiscalIssuerSettingsService } from './fiscal-issuer-settings.service';
import { FiscalController } from './fiscal.controller';
import { InboundDistribuicaoProcessorService } from './inbound/inbound-distribuicao.processor';
import { InboundNfeController } from './inbound/inbound-nfe.controller';
import { InboundNfeService } from './inbound/inbound-nfe.service';
import { InboundNfeStorage } from './inbound/inbound-nfe.storage';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [
    FiscalController,
    FiscalDocumentsController,
    FiscalIssuerSettingsController,
    InboundNfeController,
  ],
  providers: [
    FiscalDocumentsService,
    FiscalIssuerSettingsService,
    FiscalEmissionProcessorService,
    InboundNfeService,
    InboundNfeStorage,
    InboundDistribuicaoProcessorService,
  ],
  exports: [InboundNfeService],
})
export class FiscalModule {}
