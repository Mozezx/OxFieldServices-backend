import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional } from 'class-validator';

export class UpdateWorkerLocationDto {
  @ApiProperty({ example: -1.4558 })
  @Type(() => Number)
  @IsNumber()
  latitude!: number;

  @ApiProperty({ example: -48.5039 })
  @Type(() => Number)
  @IsNumber()
  longitude!: number;

  @ApiProperty({ example: 12.5, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracy?: number;
}
