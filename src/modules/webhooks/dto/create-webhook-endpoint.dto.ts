import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class CreateWebhookEndpointDto {
  @ApiProperty({ example: 'https://example.com/hooks/ox' })
  @IsUrl({ require_tld: false })
  url: string;

  @ApiProperty({
    description: 'Lista de eventos subscritos (ex.: project.created, phase.validated)',
    example: ['project.created', 'payment.released'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  events: string[];

  @ApiPropertyOptional({
    description: 'Segredo para HMAC (gerado automaticamente se omitido)',
  })
  @IsOptional()
  @IsString()
  @MinLength(16)
  secret?: string;
}
