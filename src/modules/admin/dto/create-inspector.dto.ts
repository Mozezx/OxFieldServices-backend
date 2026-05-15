import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateInspectorDto {
  @ApiProperty({ description: 'Nome completo' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'E-mail (único)' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Palavra-passe inicial (Supabase Auth); o inspetor pode alterá-la depois.',
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
}
