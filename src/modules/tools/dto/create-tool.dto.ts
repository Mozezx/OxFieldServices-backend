import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateToolDto {
  @ApiProperty({ example: 'Multímetro digital' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'uuid-da-categoria' })
  @IsUUID()
  categoryId: string;
}
