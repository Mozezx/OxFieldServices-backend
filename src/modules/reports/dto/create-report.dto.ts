import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ReportType } from '@prisma/client';

export class CreateReportDto {
  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  type: ReportType;
}
