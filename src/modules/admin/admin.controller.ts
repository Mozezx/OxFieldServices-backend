import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { ToconlineFiscalService } from '../toconline/toconline-fiscal.service';
import { LookupOrCreateClientDto } from './dto/lookup-or-create-client.dto';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { CreateInspectorDto } from './dto/create-inspector.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly toconlineFiscal: ToconlineFiscalService,
  ) {}

  @Post('clients/lookup-or-create')
  @Roles('admin')
  @ApiOperation({ summary: 'Buscar ou criar cliente por email (apenas admin)' })
  lookupOrCreateClient(@Body() dto: LookupOrCreateClientDto) {
    return this.adminService.lookupOrCreateClient(dto);
  }

  @Post('workers')
  @Roles('admin')
  @ApiOperation({ summary: 'Criar worker (stub até primeiro sync de auth)' })
  createWorker(@Body() dto: CreateWorkerDto) {
    return this.adminService.createWorker(dto);
  }

  @Get('inspectors')
  @Roles('admin')
  @ApiOperation({ summary: 'Listar inspetores' })
  listInspectors() {
    return this.adminService.listInspectors();
  }

  @Post('inspectors')
  @Roles('admin')
  @ApiOperation({ summary: 'Criar inspetor de qualidade' })
  createInspector(@Body() dto: CreateInspectorDto) {
    return this.adminService.createInspector(dto);
  }

  @Delete('inspectors/:inspectorId')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar inspetor e utilizador associado' })
  deleteInspector(@Param('inspectorId') inspectorId: string) {
    return this.adminService.deleteInspector(inspectorId);
  }

  @Post('invoices/:invoiceId/communicate-at')
  @Roles('admin')
  @ApiOperation({
    summary: 'Re-comunicar documento TOConline à AT (credenciais em env)',
  })
  communicateInvoiceAt(@Param('invoiceId') invoiceId: string) {
    return this.toconlineFiscal.retryCommunicateToAT(invoiceId);
  }

  @Post('invoices/:invoiceId/fiscal-pdf')
  @Roles('admin')
  @ApiOperation({
    summary: 'Buscar PDF fiscal diretamente no TOConline e atualizar a invoice',
  })
  pullInvoiceFiscalPdf(@Param('invoiceId') invoiceId: string) {
    return this.toconlineFiscal.pullFiscalPdfFromToconline(invoiceId);
  }

  @Delete('workers/:workerId')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar worker e utilizador associado' })
  deleteWorker(@Param('workerId') workerId: string) {
    return this.adminService.deleteWorker(workerId);
  }
}
