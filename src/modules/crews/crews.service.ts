import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AssignmentRole,
  Prisma,
  ProjectStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { ContractsService } from '../contracts/contracts.service';
import { AddCrewMemberDto } from './dto/add-crew-member.dto';
import { AssignCrewToProjectDto } from './dto/assign-crew-to-project.dto';
import { CreateCrewDto } from './dto/create-crew.dto';
import { UpdateCrewDto } from './dto/update-crew.dto';

const ASSIGNMENT_ALLOWED_STATUSES: ProjectStatus[] = [
  ProjectStatus.matched,
  ProjectStatus.contract_signed,
  ProjectStatus.active_escrow,
  ProjectStatus.in_execution,
  ProjectStatus.closing,
];

const crewInclude = {
  members: {
    orderBy: { addedAt: 'asc' as const },
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
  },
} satisfies Prisma.CrewInclude;

@Injectable()
export class CrewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentsService: AssignmentsService,
    private readonly contractsService: ContractsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async resolveUserId(userKey: string): Promise<string> {
    const key = userKey?.trim();
    if (!key) {
      throw new ForbiddenException('Sessão inválida.');
    }
    const u = await this.prisma.user.findFirst({
      where: { OR: [{ id: key }, { authId: key }] },
      select: { id: true },
    });
    if (!u) throw new ForbiddenException('Utilizador não encontrado.');
    return u.id;
  }

  private async getUserOrganizationIds(userId: string): Promise<string[]> {
    const ms = await this.prisma.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    return ms.map((m) => m.organizationId);
  }

  private async getAdminOrganizationIdForWrite(userId: string): Promise<string> {
    const m = await this.prisma.organizationMember.findFirst({
      where: { userId, role: 'admin' },
      orderBy: { joinedAt: 'asc' },
      select: { organizationId: true },
    });
    if (!m) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user?.role === 'admin') {
        const anyMembership = await this.prisma.organizationMember.findFirst({
          where: { userId },
          orderBy: { joinedAt: 'asc' },
          select: { organizationId: true },
        });
        if (anyMembership) {
          await this.prisma.organizationMember.update({
            where: {
              organizationId_userId: {
                organizationId: anyMembership.organizationId,
                userId,
              },
            },
            data: { role: 'admin' },
          });
          return anyMembership.organizationId;
        }

        const firstOrg = await this.prisma.organization.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        const organizationId =
          firstOrg?.id ??
          (
            await this.prisma.organization.create({
              data: {
                name: 'Default Organization',
                slug: `default-org-${randomUUID().slice(0, 8)}`,
              },
              select: { id: true },
            })
          ).id;

        await this.prisma.organizationMember.upsert({
          where: {
            organizationId_userId: {
              organizationId,
              userId,
            },
          },
          create: {
            organizationId,
            userId,
            role: 'admin',
          },
          update: {
            role: 'admin',
          },
        });
        return organizationId;
      }
      throw new ForbiddenException(
        'Utilizador não pertence a nenhuma organização como admin.',
      );
    }
    return m.organizationId;
  }

  async list(userKey: string) {
    const userId = await this.resolveUserId(userKey);
    const orgIds = await this.getUserOrganizationIds(userId);
    if (orgIds.length === 0) return [];

    return this.prisma.crew.findMany({
      where: { organizationId: { in: orgIds } },
      orderBy: { createdAt: 'desc' },
      include: crewInclude,
    });
  }

  async create(userKey: string, dto: CreateCrewDto) {
    const userId = await this.resolveUserId(userKey);
    const organizationId = await this.getAdminOrganizationIdForWrite(userId);

    return this.prisma.crew.create({
      data: {
        organizationId,
        createdBy: userId,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? null,
      },
      include: crewInclude,
    });
  }

  async update(userKey: string, crewId: string, dto: UpdateCrewDto) {
    const userId = await this.resolveUserId(userKey);
    const orgIds = await this.getUserOrganizationIds(userId);

    const existing = await this.prisma.crew.findUnique({
      where: { id: crewId },
      select: { organizationId: true },
    });
    if (!existing || !orgIds.includes(existing.organizationId)) {
      throw new NotFoundException('Equipe não encontrada');
    }

    const data: Prisma.CrewUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) {
      data.description = dto.description.trim() === '' ? null : dto.description.trim();
    }
    if (Object.keys(data).length === 0) {
      return this.prisma.crew.findUniqueOrThrow({
        where: { id: crewId },
        include: crewInclude,
      });
    }

    return this.prisma.crew.update({
      where: { id: crewId },
      data,
      include: crewInclude,
    });
  }

  async remove(userKey: string, crewId: string) {
    const userId = await this.resolveUserId(userKey);
    const orgIds = await this.getUserOrganizationIds(userId);

    const existing = await this.prisma.crew.findUnique({
      where: { id: crewId },
      select: { organizationId: true },
    });
    if (!existing || !orgIds.includes(existing.organizationId)) {
      throw new NotFoundException('Equipe não encontrada');
    }

    await this.prisma.crew.delete({ where: { id: crewId } });
    return { ok: true };
  }

  async addMember(userKey: string, crewId: string, dto: AddCrewMemberDto) {
    const userId = await this.resolveUserId(userKey);
    const orgIds = await this.getUserOrganizationIds(userId);

    const crew = await this.prisma.crew.findUnique({
      where: { id: crewId },
      select: { organizationId: true },
    });
    if (!crew || !orgIds.includes(crew.organizationId)) {
      throw new NotFoundException('Equipe não encontrada');
    }

    const worker = await this.prisma.worker.findUnique({
      where: { id: dto.workerId },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('Worker não encontrado');

    try {
      await this.prisma.crewMember.create({
        data: {
          crewId,
          workerId: dto.workerId,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('Este worker já está nesta equipe.');
      }
      throw e;
    }

    return this.prisma.crew.findUniqueOrThrow({
      where: { id: crewId },
      include: crewInclude,
    });
  }

  async removeMember(
    userKey: string,
    crewId: string,
    workerId: string,
  ) {
    const userId = await this.resolveUserId(userKey);
    const orgIds = await this.getUserOrganizationIds(userId);

    const crew = await this.prisma.crew.findUnique({
      where: { id: crewId },
      select: { organizationId: true },
    });
    if (!crew || !orgIds.includes(crew.organizationId)) {
      throw new NotFoundException('Equipe não encontrada');
    }

    await this.prisma.crewMember.delete({
      where: {
        crewId_workerId: { crewId, workerId },
      },
    });

    return this.prisma.crew.findUniqueOrThrow({
      where: { id: crewId },
      include: crewInclude,
    });
  }

  async assignCrewToProject(
    userKey: string,
    projectId: string,
    dto: AssignCrewToProjectDto,
  ) {
    const adminUserId = await this.resolveUserId(userKey);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        status: true,
        organizationId: true,
      },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    if (!ASSIGNMENT_ALLOWED_STATUSES.includes(project.status)) {
      throw new BadRequestException(
        `Atribuições não são permitidas no status atual do projeto (${project.status}).`,
      );
    }

    const orgIds = await this.getUserOrganizationIds(adminUserId);
    const crew = await this.prisma.crew.findUnique({
      where: { id: dto.crewId },
      include: {
        members: {
          orderBy: { addedAt: 'asc' },
          select: { workerId: true },
        },
      },
    });
    if (!crew) throw new NotFoundException('Equipe não encontrada');

    if (!orgIds.includes(crew.organizationId)) {
      throw new ForbiddenException('Sem permissão para esta equipe.');
    }

    // Backfill automático para projetos legados sem organização.
    if (!project.organizationId) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { organizationId: crew.organizationId },
      });
      project.organizationId = crew.organizationId;
    }

    if (crew.organizationId !== project.organizationId) {
      throw new BadRequestException(
        'A equipe não pertence à mesma organização do projeto.',
      );
    }

    const leadRow = await this.prisma.projectAssignment.findFirst({
      where: {
        projectId,
        role: AssignmentRole.lead_worker,
        removedAt: null,
      },
      select: { workerId: true },
    });
    const projectWithContract = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        contract: { select: { workerId: true } },
      },
    });
    let leadEstablished =
      !!leadRow || !!projectWithContract?.contract?.workerId;

    const assigned: string[] = [];
    const skippedDuplicate: string[] = [];
    const skippedUnavailable: string[] = [];

    const fieldRole = dto.role ?? AssignmentRole.field_worker;
    if (fieldRole === AssignmentRole.lead_worker) {
      throw new BadRequestException(
        'Use o papel field_worker (ou omita role) ao atribuir equipes; o responsável pelo contrato é o primeiro membro elegível.',
      );
    }

    for (const { workerId } of crew.members) {
      const active = await this.prisma.projectAssignment.findFirst({
        where: {
          projectId,
          workerId,
          removedAt: null,
        },
      });
      if (active) {
        skippedDuplicate.push(workerId);
        continue;
      }

      const worker = await this.prisma.worker.findUnique({
        where: { id: workerId },
        select: { available: true },
      });
      if (!worker) continue;
      if (!worker.available) {
        skippedUnavailable.push(workerId);
        continue;
      }

      if (!leadEstablished) {
        this.eventEmitter.emit('worker.invited', { projectId, workerId });
        await this.contractsService.create({ projectId, workerId });
        await this.assignmentsService.syncLeadWorkerFromContract(
          projectId,
          workerId,
          adminUserId,
        );
        leadEstablished = true;
        assigned.push(workerId);
        continue;
      }

      await this.assignmentsService.assign(
        projectId,
        { workerId, role: fieldRole },
        adminUserId,
      );
      assigned.push(workerId);
    }

    if (!leadEstablished) {
      throw new BadRequestException(
        'Não foi possível definir um responsável pelo contrato: nenhum membro disponível ou todos já estavam atribuídos.',
      );
    }

    return {
      assigned,
      skippedDuplicate,
      skippedUnavailable,
    };
  }
}
