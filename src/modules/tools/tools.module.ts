import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';

@Module({
  imports: [PrismaModule],
  controllers: [ToolsController],
  providers: [ToolsService],
})
export class ToolsModule {}
