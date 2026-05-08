import { AssignmentRole } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class AssignCrewToProjectDto {
  @IsUUID()
  crewId!: string;

  @IsOptional()
  @IsEnum(AssignmentRole)
  role?: AssignmentRole;
}
