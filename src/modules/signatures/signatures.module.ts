import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';

@Module({
  imports: [ConfigModule, PrismaModule, ProjectsModule],
  controllers: [SignaturesController],
  providers: [SignaturesService],
})
export class SignaturesModule {}
