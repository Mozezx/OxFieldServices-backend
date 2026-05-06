import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ValidatePhaseDto {
  @ApiProperty({ description: 'true = aprovado, false = retrabalho solicitado' })
  @IsBoolean()
  approved: boolean;

  @ApiPropertyOptional({ description: 'Motivo do retrabalho (obrigatório ao rejeitar)', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
