import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RegisterEvidenceDto {
  @ApiProperty({ description: 'Path no Supabase Storage (ex: phases/uuid/key.mp4)' })
  @IsString()
  storagePath: string;

  @ApiProperty({ description: 'MIME type do arquivo' })
  @IsString()
  mimeType: string;

  @ApiProperty({ description: 'Tamanho do arquivo em bytes' })
  @IsNumber()
  @Min(1)
  @Max(300 * 1024 * 1024)
  size: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  gpsAccuracy?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}
