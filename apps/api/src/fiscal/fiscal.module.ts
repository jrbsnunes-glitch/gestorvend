import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { FiscalDocumentsController } from './fiscal-documents.controller';

import { FiscalDocumentsService } from './fiscal-documents.service';

import { FiscalEmissionProcessorService } from './fiscal-emission.processor';

import { FiscalIssuerSettingsController } from './fiscal-issuer-settings.controller';

import { FiscalIssuerSettingsService } from './fiscal-issuer-settings.service';

import { FiscalController } from './fiscal.controller';



@Module({

  imports: [PrismaModule],

  controllers: [

    FiscalController,

    FiscalDocumentsController,

    FiscalIssuerSettingsController,

  ],

  providers: [

    FiscalDocumentsService,

    FiscalIssuerSettingsService,

    FiscalEmissionProcessorService,

  ],

})

export class FiscalModule {}

