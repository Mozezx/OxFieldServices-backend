import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ProcessCaptureDto {
  @ApiProperty({ description: 'Texto livre a processar', maxLength: 3000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  text!: string;
}
