import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class CreateGalleryLinkDto {
  @ApiPropertyOptional({
    description: 'Data/hora ISO 8601 de expiração do link (opcional).',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
