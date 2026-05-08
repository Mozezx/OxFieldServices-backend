import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCrewDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
