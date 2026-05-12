import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { HUBSPOT_SYNC_QUEUE } from './hubspot.constants';
import { HubspotConfig } from './hubspot.config';
import { HubspotMapper } from './hubspot.mapper';
import { HubspotService } from './hubspot.service';
import { HubspotQueue } from './hubspot.queue';
import { HubspotProcessor } from './hubspot.processor';
import { HubspotController } from './hubspot.controller';
import { HubspotListener } from './hubspot.listener';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    BullModule.registerQueue({ name: HUBSPOT_SYNC_QUEUE }),
  ],
  controllers: [HubspotController],
  providers: [
    {
      provide: HubspotConfig,
      useFactory: (config: ConfigService) => new HubspotConfig(config),
      inject: [ConfigService],
    },
    HubspotMapper,
    HubspotService,
    HubspotQueue,
    HubspotProcessor,
    HubspotListener,
  ],
  exports: [HubspotQueue, HubspotService],
})
export class HubspotModule {}
