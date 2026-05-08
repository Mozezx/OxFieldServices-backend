import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class PatchWorkerVisibleLabelsDto {
  @ApiProperty({ type: [String], example: ['active', 'scheduled'] })
  @IsArray()
  @IsString({ each: true })
  labelIds!: string[];
}
