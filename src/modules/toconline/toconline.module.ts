import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ToconlineConfig } from './toconline.config';
import { ToconlineAuthService } from './toconline-auth.service';
import { ToconlineClientService } from './toconline-client.service';
import { ToconlineSalesDocumentService } from './toconline-sales-document.service';
import { ToconlineFiscalService } from './toconline-fiscal.service';
import { ToconlineListener } from './toconline.listener';

@Module({
  imports: [ConfigModule, PrismaModule, NotificationsModule],
  providers: [
    ToconlineConfig,
    ToconlineAuthService,
    ToconlineClientService,
    ToconlineSalesDocumentService,
    ToconlineFiscalService,
    ToconlineListener,
  ],
  exports: [ToconlineConfig, ToconlineAuthService, ToconlineFiscalService, ToconlineSalesDocumentService],
})
export class ToconlineModule {}
