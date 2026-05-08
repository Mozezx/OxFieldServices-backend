import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AssignmentRole, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { AssignWorkerDto } from './dto/assign-worker.dto';

const ASSIGNMENT_ALLOWED_STATUSES: ProjectStatus[] = [
  ProjectStatus.matched,
  ProjectStatus.contract_signed,
  ProjectStatus.active_escrow,
  ProjectStatus.in_execution,
  ProjectStatus.closing,
];

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cache: CacheService,
  ) {}

  private assertProjectAllowsAssignments(status: ProjectStatus) {
    if (!ASSIGNMENT_ALLOWED_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Atribuições não são permitidas no status atual do projeto (${status}).`,
      );
    }
  }

  async assign(
    projectId: string,
    dto: AssignWorkerDto,
    adminUserId: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    this.assertProjectAllowsAssignments(project.status);

    const worker = await this.prisma.worker.findUnique({
      where: { id: dto.workerId },
    });
    if (!worker) throw new NotFoundException('Worker não encontrado');
    if (!worker.available) {
      throw new BadRequestException(
        'Worker não está disponível para novos projetos.',
      );
    }

    const duplicate = await this.prisma.projectAssignment.findFirst({
      where: {
        projectId,
        workerId: dto.workerId,
        removedAt: null,
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        'Este worker já está atribuído a este projeto.',
      );
    }

    const row = await this.prisma.projectAssignment.create({
      data: {
        projectId,
        workerId: dto.workerId,
        assignedBy: adminUserId,
        role: dto.role ?? AssignmentRole.field_worker,
      },
      include: {
        worker: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
        project: { select: { id: true, title: true, status: true } },
      },
    });

    this.eventEmitter.emit('worker.assigned_to_project', {
      projectId,
      workerId: dto.workerId,
      assignmentId: row.id,
    });

    await this.cache.invalidateByPrefix('projects:list:');

    return row;
  }

  async unassign(
    projectId: string,
    workerId: string,
    adminUserId: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    this.assertProjectAllowsAssignments(project.status);

    const active = await this.prisma.projectAssignment.findFirst({
      where: { projectId, workerId, removedAt: null },
    });
    if (!active) {
      throw new NotFoundException('Atribuição ativa não encontrada.');
    }

    await this.prisma.projectAssignment.update({
      where: { id: active.id },
      data: {
        removedAt: new Date(),
        removedBy: adminUserId,
      },
    });

    await this.prisma.projectPhase.updateMany({
      where: { projectId, assignedWorkerId: workerId },
      data: { assignedWorkerId: null },
    });

    this.eventEmitter.emit('worker.removed_from_project', {
      projectId,
      workerId,
    });

    await this.cache.invalidateByPrefix('projects:list:');

    return { ok: true };
  }

  async listByProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    return this.prisma.projectAssignment.findMany({
      where: { projectId, removedAt: null },
      orderBy: { assignedAt: 'asc' },
      include: {
        worker: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Alinha `lead_worker` ao worker do contrato após matching/contrato (substitui outros leads).
   */
  async syncLeadWorkerFromContract(
    projectId: string,
    leadWorkerId: string,
    adminUserId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const removedLeads = await tx.projectAssignment.findMany({
        where: {
          projectId,
          role: AssignmentRole.lead_worker,
          removedAt: null,
          workerId: { not: leadWorkerId },
        },
        select: { workerId: true },
      });
      const removedLeadIds = removedLeads.map((r) => r.workerId);

      await tx.projectAssignment.updateMany({
        where: {
          projectId,
          role: AssignmentRole.lead_worker,
          removedAt: null,
          workerId: { not: leadWorkerId },
        },
        data: {
          removedAt: new Date(),
          removedBy: adminUserId,
        },
      });

      if (removedLeadIds.length > 0) {
        await tx.projectPhase.updateMany({
          where: {
            projectId,
            assignedWorkerId: { in: removedLeadIds },
          },
          data: { assignedWorkerId: null },
        });
      }

      const mine = await tx.projectAssignment.findFirst({
        where: { projectId, workerId: leadWorkerId, removedAt: null },
      });

      if (mine) {
        if (mine.role !== AssignmentRole.lead_worker) {
          await tx.projectAssignment.update({
            where: { id: mine.id },
            data: { role: AssignmentRole.lead_worker },
          });
        }
      } else {
        await tx.projectAssignment.create({
          data: {
            projectId,
            workerId: leadWorkerId,
            role: AssignmentRole.lead_worker,
            assignedBy: adminUserId,
          },
        });
      }
    });
  }

  async listByWorker(workerId: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('Worker não encontrado');

    return this.prisma.projectAssignment.findMany({
      where: { workerId, removedAt: null },
      orderBy: { assignedAt: 'desc' },
      include: {
        project: {
          select: { id: true, title: true, status: true, location: true },
        },
      },
    });
  }
}
