import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { ContractsModule } from '../contracts/contracts.module';
import { CrewsController } from './crews.controller';
import { CrewsService } from './crews.service';

@Module({
  imports: [AssignmentsModule, ContractsModule],
  controllers: [CrewsController],
  providers: [CrewsService],
  exports: [CrewsService],
})
export class CrewsModule {}
