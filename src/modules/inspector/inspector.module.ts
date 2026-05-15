import { Module } from '@nestjs/common';
import { InspectorController } from './inspector.controller';
import { InspectorService } from './inspector.service';

@Module({
  controllers: [InspectorController],
  providers: [InspectorService],
})
export class InspectorModule {}
