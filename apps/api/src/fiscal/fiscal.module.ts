import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { FiscalDocumentsController } from './fiscal-documents.controller';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalEmissionProcessorService } from './fiscal-emission.processor';
import { FiscalSefazOpsService } from './fiscal-sefaz-ops.service';
import { FiscalManualNfeService } from './fiscal-manual-nfe.service';
import { FiscalIssuerSettingsController } from './fiscal-issuer-settings.controller';
import { FiscalIssuerSettingsService } from './fiscal-issuer-settings.service';
import { FiscalController } from './fiscal.controller';
import { InboundDistribuicaoProcessorService } from './inbound/inbound-distribuicao.processor';
import { InboundNfeController } from './inbound/inbound-nfe.controller';
import { InboundNfeService } from './inbound/inbound-nfe.service';
import { InboundNfeStorage } from './inbound/inbound-nfe.storage';
import { IssuerCertificateStorage } from './issuer/issuer-certificate.storage';
import { OutboundNfeStorage } from './issuer/outbound-nfe.storage';

@Module({
  imports: [PrismaModule, UsersModule, InventoryModule, SalesModule],
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
    FiscalSefazOpsService,
    FiscalManualNfeService,
    InboundNfeService,
    InboundNfeStorage,
    InboundDistribuicaoProcessorService,
    IssuerCertificateStorage,
    OutboundNfeStorage,
  ],
  exports: [InboundNfeService],
})
export class FiscalModule {}
