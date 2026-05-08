import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional } from 'class-validator';

/** Campos GPS opcionais para upload (multipart) ou PATCH /phase-evidence/:id/location */
export class EvidenceGpsDto {
  @ApiPropertyOptional({ description: 'Latitude em graus decimais' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude em graus decimais' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Precisão do GPS em metros (aprox.)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  gpsAccuracy?: number;

  @ApiPropertyOptional({ description: 'Instante da captura (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}
