import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PhasesService } from './phases.service';
import { EvidenceService } from './evidence.service';
import { UpdatePhaseStatusDto } from './dto/update-phase-status.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';
import { EvidenceGpsDto } from './dto/evidence-gps.dto';
import { RegisterEvidenceDto } from './dto/register-evidence.dto';
import { UpdateAnnotationsDto } from './dto/update-annotations.dto';
import { CreateEvidenceCommentDto } from './dto/create-evidence-comment.dto';

@ApiTags('Phases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class PhasesController {
  constructor(
    private readonly phasesService: PhasesService,
    private readonly evidenceService: EvidenceService,
  ) {}

  @Get('projects/:projectId/phases')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Listar fases de um projeto' })
  findByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('assignedToMe') assignedToMe: string | undefined,
    @Req() req: { user?: { id?: string; role?: string } },
  ) {
    const filterForWorker = assignedToMe === 'true' && req.user?.role === 'worker';
    return this.phasesService.findByProject(projectId, {
      assignedToMe: filterForWorker,
      appUserId: filterForWorker ? req.user?.id : undefined,
    });
  }

  @Post('projects/:projectId/phases')
  @Roles('admin')
  @ApiOperation({ summary: 'Adicionar fase a projeto existente (admin)' })
  addPhase(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: { name: string; order?: number; amount: number; checklist?: { label: string; requiresPhoto?: boolean; order?: number }[] },
  ) {
    return this.phasesService.addPhaseToProject(projectId, dto);
  }

  @Patch('projects/:projectId/phases/:phaseId')
  @Roles('admin')
  @ApiOperation({
    summary: 'Atualizar fase (ex.: responsável pela tarefa)',
    description:
      'assignedWorkerId deve referir um worker com ProjectAssignment ativo no projeto; null remove.',
  })
  patchPhase(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Body() dto: UpdatePhaseDto,
  ) {
    return this.phasesService.updatePhaseForProject(projectId, phaseId, dto);
  }

  @Get('phases/:id')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Obter detalhes de uma fase' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.phasesService.findOne(id);
  }

  @Patch('phases/:id/status')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Atualizar status de uma fase' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: UpdatePhaseStatusDto,
  ) {
    return this.phasesService.updateStatus(id, req.user.id, dto);
  }

  // ─── Evidências ────────────────────────────────────────

  @Post('phases/:id/evidence')
  @Roles('worker')
  @ApiOperation({ summary: 'Upload de evidência para uma fase (worker)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        latitude: { type: 'number', description: 'Opcional — graus decimais' },
        longitude: { type: 'number', description: 'Opcional — graus decimais' },
        gpsAccuracy: { type: 'number', description: 'Opcional — metros (aprox.)' },
        capturedAt: {
          type: 'string',
          format: 'date-time',
          description: 'Opcional — ISO 8601',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 300 * 1024 * 1024 } }))
  uploadEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() gps: EvidenceGpsDto,
  ) {
    return this.evidenceService.upload(id, file, req.user.id, req, gps ?? {});
  }

  @Post('phases/:id/evidence/register')
  @Roles('worker')
  @ApiOperation({ summary: 'Registrar evidência já enviada ao Storage diretamente (worker)' })
  @ApiBody({ type: RegisterEvidenceDto })
  registerEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: RegisterEvidenceDto,
  ) {
    return this.evidenceService.register(id, req.user.id, dto, req);
  }

  @Patch('phase-evidence/:id/location')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Atualizar coordenadas GPS de uma evidência' })
  @ApiBody({ type: EvidenceGpsDto })
  updateEvidenceLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: EvidenceGpsDto,
  ) {
    return this.evidenceService.updateLocation(id, req.user.id, dto);
  }

  @Patch('phase-evidence/:id/annotations')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Atualizar dados de anotação (JSON) na evidência' })
  @ApiBody({ type: UpdateAnnotationsDto })
  updateEvidenceAnnotations(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: UpdateAnnotationsDto,
  ) {
    return this.evidenceService.updateAnnotations(id, req.user.id, dto);
  }

  @Get('phase-evidence/:id/comments')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Listar comentários da evidência (autores com nome e avatar)' })
  listEvidenceComments(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.evidenceService.listComments(id, req.user.id);
  }

  @Post('phase-evidence/:id/comments')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Adicionar comentário à evidência' })
  @ApiBody({ type: CreateEvidenceCommentDto })
  createEvidenceComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: CreateEvidenceCommentDto,
  ) {
    return this.evidenceService.createComment(id, req.user.id, dto);
  }

  @Delete('phase-evidence/comments/:commentId')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Remover comentário (soft delete)' })
  deleteEvidenceComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Req() req: any,
  ) {
    return this.evidenceService.deleteComment(commentId, req.user.id);
  }

  @Get('phases/:id/evidence')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Listar evidências de uma fase' })
  listEvidence(@Param('id', ParseUUIDPipe) id: string) {
    return this.evidenceService.findByPhase(id);
  }

  @Delete('evidence/:evidenceId')
  @Roles('worker', 'admin')
  @ApiOperation({ summary: 'Remover uma evidência' })
  removeEvidence(
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Req() req: any,
  ) {
    return this.evidenceService.remove(evidenceId, req.user.id);
  }
}
