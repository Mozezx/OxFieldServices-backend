import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class PublicIdentifyDto {
  @ApiProperty({ description: 'Email para contacto / notificações' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ description: 'Nome apresentado ao equipa' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;
}
