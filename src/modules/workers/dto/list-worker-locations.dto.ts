import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ListWorkerLocationsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ example: 240, description: 'Workers vistos nos últimos X minutos' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  recentMinutes?: number;
}
