import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TemplatePhaseChecklistItemDto {
  @ApiProperty()
  @IsString()
  label: string;

  @ApiPropertyOptional({ description: 'Se a verificação exige foto.' })
  @IsOptional()
  requiresPhoto?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  order?: number;
}

export class CreatePhaseTemplateDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ description: 'Ordem da fase (>=1)' })
  @IsInt()
  @Min(1)
  order: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Itens de checklist sugeridos para a fase.',
    type: [TemplatePhaseChecklistItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplatePhaseChecklistItemDto)
  checklist?: TemplatePhaseChecklistItemDto[];
}

export class CreateTemplateDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ type: [CreatePhaseTemplateDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePhaseTemplateDto)
  phases?: CreatePhaseTemplateDto[];
}
