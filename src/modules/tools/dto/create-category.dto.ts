import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Elétrica' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  name: string;
}
