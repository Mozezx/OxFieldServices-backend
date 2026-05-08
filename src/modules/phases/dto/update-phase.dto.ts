import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class UpdatePhaseDto {
  @ApiPropertyOptional({
    description:
      'Worker responsável pela fase (deve ter ProjectAssignment ativo no projeto). Envie null para limpar.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  assignedWorkerId?: string | null;
}
