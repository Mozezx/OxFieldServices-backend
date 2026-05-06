import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Corpo opcional para checkout (extensível) */
export class RequestToolDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
