import { ApiPropertyOptional } from '@nestjs/swagger';
import { WorkerAccessTier } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateWorkerDto {
  @ApiPropertyOptional({ example: ['eletrica', 'hidraulica'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  shelterCertified?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ enum: WorkerAccessTier })
  @IsOptional()
  @IsEnum(WorkerAccessTier)
  accessTier?: WorkerAccessTier;
}
