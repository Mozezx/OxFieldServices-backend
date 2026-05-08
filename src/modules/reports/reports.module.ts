import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { REPORT_GENERATION_QUEUE } from './reports.constants';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportProcessor } from './report.processor';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ProjectsModule,
    BullModule.registerQueue({ name: REPORT_GENERATION_QUEUE }),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportProcessor],
})
export class ReportsModule {}
