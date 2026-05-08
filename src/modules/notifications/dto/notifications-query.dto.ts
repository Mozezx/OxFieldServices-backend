import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class NotificationsQueryDto {
  @ApiPropertyOptional({
    description: 'ISO8601 — apenas notificações com createdAt >= since (ex.: últimas 24h)',
  })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({
    description: 'ISO date cursor (createdAt of last item) for pagination',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
