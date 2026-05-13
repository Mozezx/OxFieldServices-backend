import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWorkerDto {
  @ApiProperty({ description: 'Nome completo' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'E-mail (único)' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ description: 'Telefone' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ description: 'Lista de skills', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];
}
