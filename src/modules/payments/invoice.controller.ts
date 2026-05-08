import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Criar invoice em rascunho (admin)' })
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoiceService.createInvoice(dto);
  }

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Listar todas as invoices (admin)' })
  listAll() {
    return this.invoiceService.listAllAdmin();
  }

  @Get('stats')
  @Roles('admin')
  @ApiOperation({ summary: 'Estatísticas de invoices (admin)' })
  getStats() {
    return this.invoiceService.getInvoiceStats();
  }

  @Get('project/:projectId')
  @Roles('admin')
  @ApiOperation({ summary: 'Listar invoices de um projeto (admin)' })
  listByProject(@Param('projectId') projectId: string) {
    return this.invoiceService.listByProject(projectId);
  }

  @Get(':id/public')
  @Public()
  @ApiOperation({
    summary: 'Dados públicos da invoice (cliente final; requer token)',
  })
  @ApiQuery({ name: 'token', required: true })
  getPublic(@Param('id') id: string, @Query('token') token: string) {
    return this.invoiceService.getPublicInvoice(id, token);
  }

  @Post(':id/intent')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Criar PaymentIntent para pagamento na página pública (cliente final)',
  })
  @ApiQuery({ name: 'token', required: true })
  createIntent(@Param('id') id: string, @Query('token') token: string) {
    return this.invoiceService.createPublicPaymentIntent(id, token);
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Detalhe da invoice (admin)' })
  findOne(@Param('id') id: string) {
    return this.invoiceService.findOneAdmin(id);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Atualizar invoice em rascunho (admin)' })
  updateDraft(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return this.invoiceService.updateDraftInvoice(id, dto);
  }

  @Post(':id/send')
  @Roles('admin')
  @ApiOperation({
    summary:
      'Gerar link Stripe e marcar como enviada; devolve URL + publicToken. Body opcional: { resendEmail: true } para reenviar e-mail quando já enviada',
  })
  send(
    @Param('id') id: string,
    @Body() body?: { resendEmail?: boolean },
  ) {
    return this.invoiceService.sendInvoice(id, body);
  }

  @Post(':id/cancel')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancelar invoice (admin)' })
  async cancel(@Param('id') id: string) {
    await this.invoiceService.cancelInvoice(id);
    return { cancelled: true };
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Apagar apenas invoices em rascunho (admin)' })
  async remove(@Param('id') id: string) {
    await this.invoiceService.deleteDraft(id);
    return { deleted: true };
  }
}
