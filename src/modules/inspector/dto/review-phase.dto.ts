import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export type ReviewAction = 'approve' | 'reject';

export class ReviewPhaseDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsEnum(['approve', 'reject'])
  action: ReviewAction;

  @ApiProperty({ required: false, description: 'Obrigatório quando action=reject' })
  @IsOptional()
  @IsString()
  @ValidateIf((o: ReviewPhaseDto) => o.action === 'reject')
  comment?: string;
}
