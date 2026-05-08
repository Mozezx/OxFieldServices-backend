import { ApiProperty } from '@nestjs/swagger';
import { SignatureTarget } from '@prisma/client';
import { IsEnum, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateSignatureDto {
  @ApiProperty({
    description:
      'Assinatura em PNG/JPEG (base64 ou data URL), ou SVG (texto ou base64)',
  })
  @IsString()
  @MinLength(32)
  signatureData: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  signerName: string;

  @ApiProperty({ example: 'admin' })
  @IsString()
  @MinLength(1)
  signerRole: string;

  @ApiProperty({ enum: SignatureTarget })
  @IsEnum(SignatureTarget)
  entityType: SignatureTarget;

  @ApiProperty()
  @IsUUID()
  entityId: string;
}
