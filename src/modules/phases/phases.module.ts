import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PhasesController } from './phases.controller';
import { PhasesService } from './phases.service';
import { EvidenceService } from './evidence.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AI_CAPTION_QUEUE } from '../ai/ai.constants';

@Module({
  imports: [NotificationsModule, BullModule.registerQueue({ name: AI_CAPTION_QUEUE })],
  controllers: [PhasesController],
  providers: [PhasesService, EvidenceService],
  exports: [PhasesService, EvidenceService],
})
export class PhasesModule {}
