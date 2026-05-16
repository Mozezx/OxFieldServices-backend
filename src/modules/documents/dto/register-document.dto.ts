import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';

export class RegisterDocumentDto {
  @ApiProperty({ description: 'Path no Supabase Storage (ex: projectId/key-arquivo.pdf)' })
  @IsString()
  storagePath: string;

  @ApiProperty({ description: 'MIME type do arquivo' })
  @IsString()
  mimeType: string;

  @ApiProperty({ description: 'Tamanho do arquivo em bytes' })
  @IsNumber()
  @Min(1)
  @Max(40 * 1024 * 1024)
  size: number;

  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  type: DocumentType;

  @ApiProperty({ description: 'Nome lógico do arquivo' })
  @IsString()
  @MinLength(1)
  fileName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : value))
  @IsUUID()
  phaseId?: string;
}
