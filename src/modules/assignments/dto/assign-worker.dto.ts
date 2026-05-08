import { AssignmentRole } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class AssignWorkerDto {
  @IsUUID()
  workerId!: string;

  @IsOptional()
  @IsEnum(AssignmentRole)
  role?: AssignmentRole;
}
