import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { ToconlineModule } from '../toconline/toconline.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [ConfigModule, PrismaModule, ToconlineModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
