import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePhaseStatusDto } from './dto/update-phase-status.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';
import { PhaseStatus } from '@prisma/client';

@Injectable()
export class PhasesService {
  private readonly logger = new Logger(PhasesService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Retorna todas as fases de um projeto.
   * Com `assignedToMe` + worker: se alguma fase tiver `assignedWorkerId`,
   * devolve só fases atribuídas ao worker atual ou sem responsável (legado).
   * Se nenhuma fase tiver responsável, devolve todas (legado).
   */
  async findByProject(
    projectId: string,
    options?: { assignedToMe?: boolean; appUserId?: string },
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    const phases = await this.prisma.projectPhase.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      include: {
        evidences: {
          select: {
            id: true,
            type: true,
            url: true,
            uploadedAt: true,
            uploadedBy: true,
            latitude: true,
            longitude: true,
            gpsAccuracy: true,
            capturedAt: true,
          },
        },
        assignedWorker: {
          select: {
            id: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });

    let mapped = phases.map((phase) => ({
      ...phase,
      amount: Number(phase.amount),
    }));

    if (options?.assignedToMe && options.appUserId) {
      const worker = await this.prisma.worker.findUnique({
        where: { userId: options.appUserId },
        select: { id: true },
      });
      if (worker) {
        const anyAssigned = mapped.some((p) => p.assignedWorkerId != null);
        if (anyAssigned) {
          mapped = mapped.filter(
            (p) =>
              p.assignedWorkerId == null ||
              p.assignedWorkerId === worker.id,
          );
        }
      }
    }

    return mapped;
  }

  /**
   * Retorna uma fase específica.
   */
  async findOne(id: string) {
    const phase = await this.prisma.projectPhase.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, title: true, clientId: true, status: true },
        },
        evidences: {
          select: {
            id: true,
            type: true,
            url: true,
            uploadedAt: true,
            uploadedBy: true,
            latitude: true,
            longitude: true,
            gpsAccuracy: true,
            capturedAt: true,
          },
        },
        assignedWorker: {
          select: {
            id: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
        checklists: {
          orderBy: { updatedAt: 'desc' },
          select: { source: true, items: true, updatedAt: true },
        },
      },
    });

    if (!phase) {
      throw new NotFoundException('Fase não encontrada');
    }

    const templateChecklist = phase.checklists.find((c) => c.source === 'template');
    const latestChecklist = phase.checklists[0];
    const checklistRaw = templateChecklist?.items ?? latestChecklist?.items ?? [];

    return {
      ...phase,
      amount: Number(phase.amount),
      checklistItems: this.normalizeChecklistItems(checklistRaw),
    };
  }

  private normalizeChecklistItems(
    raw: unknown,
  ): Array<{ label: string; requiresPhoto: boolean; order: number }> {
    if (!Array.isArray(raw)) return [];

    return raw
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const label = String(entry.label ?? '').trim();
        if (!label) return null;
        const requiresPhoto = entry.requiresPhoto === true;
        const orderNum = Number(entry.order);
        const order = Number.isFinite(orderNum) ? orderNum : index + 1;
        return { label, requiresPhoto, order };
      })
      .filter((item): item is { label: string; requiresPhoto: boolean; order: number } => item !== null)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Atualiza o status de uma fase (modelo documentação — sem validação financeira).
   * Transições: pending → in_progress → completed
   */
  async updateStatus(id: string, userId: string, dto: UpdatePhaseStatusDto) {
    const phase = await this.prisma.projectPhase.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            clientId: true,
            status: true,
            contract: { select: { workerId: true } },
          },
        },
      },
    });

    if (!phase) {
      throw new NotFoundException('Fase não encontrada');
    }

    const { status: newStatus } = dto;
    const currentStatus = phase.status;

    if (currentStatus === newStatus) {
      return {
        ...phase,
        amount: Number(phase.amount),
      };
    }

    if (!this.isValidPhaseTransition(currentStatus, newStatus)) {
      throw new BadRequestException(
        `Transição inválida: ${currentStatus} → ${newStatus}`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ForbiddenException('Usuário não encontrado');
    }

    if (newStatus === 'in_progress' || newStatus === 'completed') {
      if (user.role !== 'admin') {
        const worker = await this.prisma.worker.findUnique({ where: { userId } });
        const isContractWorker = worker != null && phase.project.contract?.workerId === worker.id;
        const isAssignedWorker = worker != null && phase.assignedWorkerId != null && phase.assignedWorkerId === worker.id;
        if (!worker || (!isContractWorker && !isAssignedWorker)) {
          throw new ForbiddenException(
            'Apenas o worker atribuído ou admin pode alterar o status da fase',
          );
        }
      }
    }

    const updated = await this.prisma.projectPhase.update({
      where: { id },
      data: { status: newStatus },
    });

    if (currentStatus === 'pending' && newStatus === 'in_progress') {
      this.eventEmitter.emit('phase.started', { phaseId: id });
    }

    if (newStatus === 'completed') {
      await this.maybeAdvanceProjectToClosing(phase.projectId);
    }

    return {
      ...updated,
      amount: Number(updated.amount),
    };
  }

  /** Quando todas as fases estão `completed`, avança o projeto para `closing`. */
  private async maybeAdvanceProjectToClosing(projectId: string) {
    const phases = await this.prisma.projectPhase.findMany({
      where: { projectId },
      select: { status: true },
    });
    if (phases.length === 0) return;
    if (!phases.every((p) => p.status === 'completed')) return;

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });
    if (!project) return;
    if (project.status === 'closing' || project.status === 'closed') return;

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

    this.logger.log(`Projeto ${projectId} avançado para closing (todas as fases concluídas)`);
  }

  private isValidPhaseTransition(
    current: PhaseStatus,
    next: PhaseStatus,
  ): boolean {
    const transitions: Record<PhaseStatus, PhaseStatus[]> = {
      pending: ['in_progress'],
      in_progress: ['completed'],
      completed: [],
    };

    return transitions[current]?.includes(next) ?? false;
  }

  /** Adiciona uma fase a um projeto existente (admin only). */
  async addPhaseToProject(
    projectId: string,
    dto: { name: string; order?: number; amount: number; checklist?: { label: string; requiresPhoto?: boolean; order?: number }[] },
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { phases: { select: { order: true } } },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const maxOrder = project.phases.reduce((m, p) => Math.max(m, p.order), 0);
    const order = dto.order ?? maxOrder + 1;

    const phase = await this.prisma.projectPhase.create({
      data: {
        projectId,
        name: dto.name,
        order,
        amount: dto.amount,
        ...(dto.checklist && dto.checklist.length > 0
          ? {
              checklists: {
                create: {
                  items: dto.checklist.map((item, idx) => ({
                    label: item.label,
                    requiresPhoto: item.requiresPhoto ?? false,
                    order: item.order ?? idx + 1,
                    done: false,
                  })),
                  source: 'manual',
                },
              },
            }
          : {}),
      },
      include: { checklists: true },
    });

    return { ...phase, amount: Number(phase.amount) };
  }

  /**
   * Atualiza metadados da fase (ex.: worker responsável). Valida ProjectAssignment ativo.
   */
  async updatePhaseForProject(
    projectId: string,
    phaseId: string,
    dto: UpdatePhaseDto,
  ) {
    if (!Object.prototype.hasOwnProperty.call(dto, 'assignedWorkerId')) {
      throw new BadRequestException('Nenhum campo para atualizar.');
    }

    const phase = await this.prisma.projectPhase.findFirst({
      where: { id: phaseId, projectId },
      select: { id: true },
    });

    if (!phase) {
      throw new NotFoundException('Fase não encontrada neste projeto.');
    }

    const workerId = dto.assignedWorkerId;

    if (workerId) {
      const assignment = await this.prisma.projectAssignment.findFirst({
        where: {
          projectId,
          workerId,
          removedAt: null,
        },
      });
      if (!assignment) {
        throw new BadRequestException(
          'O worker precisa estar atribuído ao projeto.',
        );
      }
    }

    const updated = await this.prisma.projectPhase.update({
      where: { id: phaseId },
      data: {
        assignedWorkerId: workerId === null ? null : workerId,
      },
      include: {
        evidences: {
          select: {
            id: true,
            type: true,
            url: true,
            uploadedAt: true,
            uploadedBy: true,
            latitude: true,
            longitude: true,
            gpsAccuracy: true,
            capturedAt: true,
          },
        },
        assignedWorker: {
          select: {
            id: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });

    return {
      ...updated,
      amount: Number(updated.amount),
    };
  }
}
