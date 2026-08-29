import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GetnetProvider } from './providers/getnet.provider';
import { MercadoPagoProvider } from './providers/mercado-pago.provider';
import { PaymentCredentialsService } from './payment-credentials.service';
import { PaymentOrchestrator } from './payment-orchestrator.service';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [PrismaModule, CompanyModule],
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [
    PaymentCredentialsService,
    PaymentOrchestrator,
    PaymentsService,
    GetnetProvider,
    MercadoPagoProvider,
  ],
  exports: [PaymentsService, PaymentCredentialsService],
})
export class PaymentsModule {}
