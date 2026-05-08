import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhooksController } from './webhooks.controller';
import { WebhooksListener } from './webhooks.listener';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDeliveryProcessor, WebhooksListener],
  exports: [WebhooksService],
})
export class WebhooksModule {}
