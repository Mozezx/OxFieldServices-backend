import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UploadProjectDocumentDto {
  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  type: DocumentType;

  @ApiProperty({ description: 'Nome lógico do ficheiro' })
  @IsString()
  @MinLength(1)
  fileName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : value))
  @IsUUID()
  phaseId?: string;
}
