import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { ContractsModule } from '../contracts/contracts.module';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

@Module({
  imports: [PrismaModule, ContractsModule, AssignmentsModule],
  controllers: [MatchingController],
  providers: [MatchingService],
})
export class MatchingModule {}
