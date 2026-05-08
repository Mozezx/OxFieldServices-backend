import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEvidenceCommentDto {
  @ApiProperty({ description: 'Texto do comentário' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content: string;

  @ApiPropertyOptional({ description: 'URL opcional de áudio anexado' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  voiceUrl?: string;
}
