import { PartialType } from '@nestjs/swagger';
import { CreateInvoiceDto } from './create-invoice.dto';

/** Atualização parcial — apenas invoices em `draft` (ver serviço). */
export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {}
