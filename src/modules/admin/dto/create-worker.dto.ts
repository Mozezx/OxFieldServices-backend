import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateWorkerDto {
  @ApiProperty({ description: 'Nome completo' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'E-mail (único)' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Palavra-passe inicial (Supabase Auth); o trabalhador pode alterá-la depois na app.',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

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
