import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
  Min,
  IsUUID,
  IsEmail,
  ArrayMinSize,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInvoiceItemDto {
  @ApiProperty({ description: 'Descrição da linha' })
  @IsString()
  description: string;

  @ApiProperty({ description: 'Quantidade', default: 1 })
  @IsNumber()
  @Min(0.01)
  quantity: number;

  @ApiProperty({ description: 'Preço unitário' })
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreateInvoiceDto {
  @ApiProperty({ description: 'Projeto ao qual a cobrança pertence' })
  @IsUUID()
  projectId: string;

  @ApiPropertyOptional({ description: 'Fase do projeto (opcional)' })
  @IsOptional()
  @IsUUID()
  phaseId?: string;

  @ApiProperty({ description: 'Nome do cliente final (pagador)' })
  @IsString()
  clientName: string;

  @ApiProperty({ description: 'E-mail do cliente (envio do link)' })
  @IsEmail()
  clientEmail: string;

  @ApiPropertyOptional({ description: 'Telefone do cliente' })
  @IsOptional()
  @IsString()
  clientPhone?: string;

  @ApiPropertyOptional({ description: 'NIF do cliente (faturação TOConline / AT)' })
  @IsOptional()
  @IsString()
  clientNif?: string;

  @ApiPropertyOptional({ description: 'Morada do cliente (opcional, fiscal)' })
  @IsOptional()
  @IsString()
  clientAddress?: string;

  @ApiPropertyOptional({ description: 'Data de vencimento (ISO)' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Notas internas / para o cliente' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Percentual de taxa OX sobre o subtotal (default OX_PLATFORM_FEE_PERCENT ou 2.5)',
    default: 2.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  feePercent?: number;

  @ApiPropertyOptional({
    description:
      'PASS_THROUGH: cliente paga subtotal + taxa. ABSORBED: cliente paga só subtotal (taxa deduzida ao contratante). Default OX_FEE_MODEL.',
    enum: ['PASS_THROUGH', 'ABSORBED'],
  })
  @IsOptional()
  @IsIn(['PASS_THROUGH', 'ABSORBED'])
  feeModel?: 'PASS_THROUGH' | 'ABSORBED';

  @ApiProperty({ type: [CreateInvoiceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];
}
