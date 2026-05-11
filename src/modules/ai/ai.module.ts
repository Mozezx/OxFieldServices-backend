import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { PhasesModule } from '../phases/phases.module';
import { AIService } from './ai.service';
import { AiController } from './ai.controller';
import { AiCaptionProcessor } from './ai-caption.processor';
import { AI_CAPTION_QUEUE } from './ai.constants';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ProjectsModule,
    PhasesModule,
    BullModule.registerQueue({ name: AI_CAPTION_QUEUE }),
  ],
  controllers: [AiController],
  providers: [AIService, AiCaptionProcessor],
  exports: [AIService],
})
export class AiModule {}
