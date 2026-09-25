import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { TenantModule } from '../tenant/tenant.module';
import { SalesModule } from '../sales/sales.module';
import { WaChatController } from './wachat.controller';
import { WaChatFactoryBotService } from './wachat-factory-bot.service';
import { WaChatFactoryService } from './wachat-factory.service';
import { WaChatService } from './wachat.service';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappFactoryWebhookController } from './whatsapp-factory-webhook.controller';

@Module({
  imports: [TenantModule, SalesModule, ManufacturingModule, CatalogModule],
  controllers: [WaChatController, WhatsappFactoryWebhookController],
  providers: [
    WaChatService,
    WaChatFactoryService,
    WaChatFactoryBotService,
    WhatsappCloudService,
  ],
})
export class WaChatModule {}
