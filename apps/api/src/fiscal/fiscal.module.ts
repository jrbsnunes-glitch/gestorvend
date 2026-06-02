import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { FiscalDocumentsController } from './fiscal-documents.controller';

import { FiscalDocumentsService } from './fiscal-documents.service';

import { FiscalEmissionProcessorService } from './fiscal-emission.processor';

import { FiscalIssuerSettingsController } from './fiscal-issuer-settings.controller';

import { FiscalIssuerSettingsService } from './fiscal-issuer-settings.service';

import { FiscalController } from './fiscal.controller';
import { InboundNfeController } from './inbound/inbound-nfe.controller';
import { InboundNfeService } from './inbound/inbound-nfe.service';
import { InboundNfeStorage } from './inbound/inbound-nfe.storage';



@Module({

  imports: [PrismaModule],

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

  ],

})

export class FiscalModule {}

