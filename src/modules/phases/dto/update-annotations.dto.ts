import { ApiProperty } from '@nestjs/swagger';
import { Allow, IsDefined } from 'class-validator';

export class UpdateAnnotationsDto {
  @ApiProperty({
    description: 'JSON livre (ex.: camadas SVG / objetos de anotação)',
    type: 'object',
    additionalProperties: true,
  })
  @IsDefined({ message: 'annotationData é obrigatório' })
  @Allow()
  annotationData: unknown;
}
