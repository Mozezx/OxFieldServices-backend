import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class PublicPhaseCommentDto {
  @ApiProperty({ example: 'Maria' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  authorName: string;

  @ApiProperty({ example: 'Podemos antecipar a pintura?' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;
}
