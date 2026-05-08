import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { DOCUMENT_OCR_QUEUE } from './documents.constants';
import { DocumentOcrProcessor } from './document-ocr.processor';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ProjectsModule,
    BullModule.registerQueue({ name: DOCUMENT_OCR_QUEUE }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentOcrProcessor],
})
export class DocumentsModule {}
