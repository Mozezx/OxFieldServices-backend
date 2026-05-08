import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { InvoiceService } from './invoice.service';
import { PaymentsController } from './payments.controller';
import { InvoiceController } from './invoice.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [PaymentsController, InvoiceController, StripeWebhookController],
  providers: [StripeService, PaymentsService, InvoiceService, RolesGuard],
  exports: [PaymentsService, StripeService, InvoiceService],
})
export class PaymentsModule {}
