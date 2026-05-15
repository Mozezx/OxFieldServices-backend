import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ReviewPhaseDto } from './dto/review-phase.dto';

@Injectable()
export class InspectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getPendingReviews() {
    const phases = await this.prisma.projectPhase.findMany({
      where: { status: 'under_review' },
      orderBy: { project: { createdAt: 'asc' } },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            location: true,
            status: true,
            createdAt: true,
          },
        },
        evidences: {
          select: {
            id: true,
            url: true,
            type: true,
            latitude: true,
            longitude: true,
            uploadedAt: true,
          },
          orderBy: { uploadedAt: 'desc' },
          take: 10,
        },
        checklists: {
          select: { id: true, items: true, source: true },
        },
        assignedWorker: {
          select: {
            id: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });

    return phases.map((phase) => ({
      ...phase,
      amount: Number(phase.amount),
      latitude: phase.evidences.find((e) => e.latitude != null)?.latitude ?? null,
      longitude: phase.evidences.find((e) => e.longitude != null)?.longitude ?? null,
    }));
  }

  async reviewPhase(phaseId: string, inspectorUserId: string, dto: ReviewPhaseDto) {
    if (dto.action === 'reject' && (!dto.comment || dto.comment.trim() === '')) {
      throw new BadRequestException('Comentário é obrigatório ao rejeitar uma fase');
    }

    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
      select: { id: true, status: true, projectId: true, name: true },
    });

    if (!phase) {
      throw new NotFoundException('Fase não encontrada');
    }

    if (phase.status !== 'under_review') {
      throw new BadRequestException(
        `Fase não está em revisão (status atual: ${phase.status})`,
      );
    }

    if (dto.action === 'approve') {
      await this.prisma.projectPhase.update({
        where: { id: phaseId },
        data: { status: 'completed', rejectionComment: null },
      });

      this.eventEmitter.emit('phase.validated', {
        phaseId,
        projectId: phase.projectId,
      });

      await this.maybeAdvanceProjectToClosing(phase.projectId);

      return { phaseId, action: 'approve', status: 'completed' };
    }

    // reject
    await this.prisma.projectPhase.update({
      where: { id: phaseId },
      data: { status: 'in_progress', rejectionComment: dto.comment!.trim() },
    });

    this.eventEmitter.emit('phase.rejected', {
      phaseId,
      projectId: phase.projectId,
      comment: dto.comment!.trim(),
    });

    return { phaseId, action: 'reject', status: 'in_progress' };
  }

  private async maybeAdvanceProjectToClosing(projectId: string) {
    const phases = await this.prisma.projectPhase.findMany({
      where: { projectId },
      select: { status: true },
    });
    if (phases.length === 0 || !phases.every((p) => p.status === 'completed')) return;

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });
    if (!project || project.status === 'closing' || project.status === 'closed') return;

    const fromStatus = project.status;
    await this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'closing' },
    });

    this.eventEmitter.emit('project.status_changed', {
      projectId,
      from: fromStatus,
      to: 'closing',
    });
  }
}
