import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { CaptureController } from './capture.controller';
import { CaptureService } from './capture.service';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [CaptureController],
  providers: [CaptureService],
})
export class CaptureModule {}
