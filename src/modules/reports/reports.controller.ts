import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  private userKey(req: { user?: { id?: string; authId?: string } }): string {
    return String(req.user?.id ?? req.user?.authId ?? '');
  }

  @Post(':id/reports')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Pedir geração de relatório PDF (processamento assíncrono)' })
  create(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Req() req: any,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.create(projectId, this.userKey(req), dto);
  }

  @Get(':id/reports/:reportId/status')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Estado da geração do relatório' })
  getStatus(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Req() req: any,
  ) {
    return this.reportsService.getStatus(projectId, reportId, this.userKey(req));
  }

  @Get(':id/reports')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Listar relatórios gerados para o projeto' })
  list(@Param('id', ParseUUIDPipe) projectId: string, @Req() req: any) {
    return this.reportsService.listForProject(projectId, this.userKey(req));
  }
}
