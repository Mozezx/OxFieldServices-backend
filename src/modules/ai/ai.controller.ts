import {
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AIService } from './ai.service';
import { EvidenceService } from '../phases/evidence.service';
import { ProjectsService } from '../projects/projects.service';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('IA (DeepSeek)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AiController {
  constructor(
    private readonly ai: AIService,
    private readonly evidenceService: EvidenceService,
    private readonly projectsService: ProjectsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('phase-evidence/:id/ai-caption')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Gerar legenda IA para evidência (DeepSeek)' })
  async aiCaption(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const userId = req.user.id as string;
    const { evidence } = await this.evidenceService.ensureEvidenceOrgAccess(id, userId);
    if (!evidence.type.startsWith('image/')) {
      return { caption: null, skipped: true as const, reason: 'not_an_image' };
    }
    const phaseContext = `Fase: ${evidence.phase.name}; Projeto: ${evidence.phase.project.title}`;
    const caption = await this.ai.generateEvidenceCaption(evidence.url, phaseContext);
    await this.prisma.phaseEvidence.update({
      where: { id },
      data: { aiCaption: caption },
    });
    return { caption };
  }

  @Post('phases/:id/ai-checklist')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Gerar checklist IA para a fase (DeepSeek)' })
  async aiChecklist(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const userKey = String(req.user?.id ?? req.user?.authId ?? '');
    const phase = await this.prisma.projectPhase.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            contract: {
              include: { worker: { select: { skills: true } } },
            },
          },
        },
      },
    });
    if (!phase) {
      throw new NotFoundException('Fase não encontrada');
    }
    await this.projectsService.ensureReportProjectAccess(phase.projectId, userKey);

    const project = phase.project;
    const projectType = [project.title, project.location].filter(Boolean).join(' — ');
    const skills = project.contract?.worker?.skills ?? [];

    const items = await this.ai.generatePhaseChecklist(phase.name, projectType, skills);

    await this.prisma.phaseChecklist.deleteMany({
      where: { phaseId: id, source: 'ai' },
    });
    await this.prisma.phaseChecklist.create({
      data: {
        phaseId: id,
        source: 'ai',
        items: items as unknown as Prisma.InputJsonValue,
      },
    });

    return { items };
  }

  @Post('projects/:id/ai-summary')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Gerar resumo executivo do projeto (DeepSeek)' })
  async aiSummary(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const userKey = String(req.user?.id ?? req.user?.authId ?? '');
    await this.projectsService.ensureReportProjectAccess(id, userKey);

    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        client: { select: { name: true } },
        phases: {
          orderBy: { order: 'asc' },
          select: {
            name: true,
            order: true,
            status: true,
          },
        },
      },
    });
    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    const projectData = {
      title: project.title,
      location: project.location,
      status: project.status,
      deadline: project.deadline?.toISOString() ?? null,
      clientName: project.client.name,
      phases: project.phases,
    };

    const summary = await this.ai.generateProjectSummary(projectData);
    return { summary };
  }
}
