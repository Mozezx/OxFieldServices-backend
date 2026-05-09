import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CacheService,
  stableCacheSegment,
} from '../../cache/cache.service';
import { TemplatesService } from '../templates/templates.service';
import { InvoiceService } from '../payments/invoice.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { RateProjectDto } from './dto/rate-project.dto';
import {
  getNextStatus,
  getAvailableEvents,
} from '../../common/state-machine/project.machine';
import {
  NotificationType,
  ProjectStatus,
  Prisma,
  UserRole,
  WorkerAccessTier,
  InvoiceStatus,
} from '@prisma/client';

/** Eventos devolvidos por GET /projects/:id/timeline */
export type TimelineEventType =
  | 'phase_started'
  | 'evidence_uploaded'
  | 'phase_validated'
  | 'payment_released'
  | 'worker_comment'
  | 'phase_rejected';

export type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  actor: {
    id: string;
    name: string;
    avatarUrl: string | null;
    role: UserRole;
  };
  phase: { id: string; name: string; order: number };
  evidence?: {
    id: string;
    fileUrl: string;
    annotationData: unknown;
    latitude: number | null;
    longitude: number | null;
  };
  comment?: string;
  metadata: Record<string, unknown>;
};

const ALLOWED_WORKER_VISIBLE_LABEL_IDS = new Set([
  'active',
  'complete',
  'lead',
  'proposal_sent',
  'scheduled',
  'unqualified',
]);

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly templatesService: TemplatesService,
    private readonly invoiceService: InvoiceService,
    private readonly cache: CacheService,
  ) {}

  private async invalidateProjectListCache(): Promise<void> {
    await this.cache.invalidateByPrefix('projects:list:');
  }

  /** Resolve id interno da tabela User a partir do id Prisma ou do authId (Supabase). */
  async resolveUserKeyToId(userKey: string): Promise<string> {
    const u = await this.requireAppUser(userKey);
    return u.id;
  }

  /** Perfil Worker ligado ao utilizador da app (fallback quando o JWT não inclui `worker`). */
  async findWorkerForAppUser(
    userId: string,
  ): Promise<{ id: string; accessTier: WorkerAccessTier } | undefined> {
    const row = await this.prisma.worker.findUnique({
      where: { userId },
      select: { id: true, accessTier: true },
    });
    return row ?? undefined;
  }

  async findWorkerIdForAppUser(userId: string): Promise<string | undefined> {
    const row = await this.findWorkerForAppUser(userId);
    return row?.id;
  }

  /** Organizações em que o utilizador é membro (visibilidade standard no app worker). */
  async findOrganizationIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    return rows.map((r) => r.organizationId);
  }

  private async requireAppUser(userKey: string): Promise<{ id: string; role: UserRole }> {
    const key = userKey?.trim();
    if (!key) {
      throw new ForbiddenException('Sessão inválida: identificador de utilizador em falta.');
    }
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: key }, { authId: key }] },
      select: { id: true, role: true },
    });
    if (!user) {
      throw new ForbiddenException(
        'Utilizador não encontrado na base de dados. Termine sessão, entre novamente ou faça POST /auth/sync.',
      );
    }
    return user;
  }

  /**
   * Cria uma obra com fases opcionais.
   *
   * Hoje só o admin cria obras (após visita presencial). O parâmetro `submit=true`
   * publica a obra direto em `matched` (pronta para matching). `submit=false` deixa
   * em `draft` como rascunho — o admin pode promover depois com o evento READY.
   */
  async create(userKey: string, dto: CreateProjectDto) {
    const appUser = await this.requireAppUser(userKey);
    let clientId = appUser.id;
    let createdByAdmin = false;

    if (appUser.role === 'admin') {
      createdByAdmin = true;
      if (dto.clientId) {
        const target = await this.prisma.user.findUnique({ where: { id: dto.clientId }, select: { id: true } });
        if (!target) throw new BadRequestException(`Cliente com id '${dto.clientId}' não encontrado.`);
        clientId = target.id;
      } else if (dto.clientEmail) {
        const target = await this.prisma.user.findUnique({ where: { email: dto.clientEmail }, select: { id: true } });
        if (!target) throw new BadRequestException(`Cliente com email '${dto.clientEmail}' não encontrado.`);
        clientId = target.id;
      }
    } else if (dto.clientId || dto.clientEmail) {
      throw new ForbiddenException('Apenas administradores podem criar projetos em nome de outro cliente.');
    }

    const {
      phases,
      clientId: _cid,
      clientEmail: _cemail,
      submit,
      templateId,
      ...projectData
    } = dto;

    const initialStatus: ProjectStatus =
      createdByAdmin && submit ? 'matched' : 'draft';

    let templateOrgId: string | null = null;
    let templatePhaseRows: Array<{
      name: string;
      order: number;
      amount: number;
      checklist: unknown | null;
    }> = [];

    if (templateId) {
      const template = await this.templatesService.assertTemplateAccessible(
        appUser.id,
        templateId,
      );
      templateOrgId = template.organizationId;

      const total = Number(projectData.budget);
      const n = template.phaseTemplates.length;
      if (n === 0) {
        throw new BadRequestException('Template não tem fases.');
      }
      const cents = Math.round(total * 100);
      const baseCents = Math.floor(cents / n);
      const remainderCents = cents - baseCents * n;

      templatePhaseRows = template.phaseTemplates.map((p, idx) => ({
        name: p.name,
        order: p.order,
        amount: (baseCents + (idx === n - 1 ? remainderCents : 0)) / 100,
        checklist: p.checklist as unknown,
      }));
    }

    if (!templateOrgId) {
      const ownMembership = await this.prisma.organizationMember.findFirst({
        where: { userId: appUser.id },
        orderBy: { joinedAt: 'asc' },
        select: { organizationId: true },
      });
      templateOrgId = ownMembership?.organizationId ?? null;
    }

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          ...projectData,
          deadline: projectData.deadline
            ? new Date(projectData.deadline)
            : undefined,
          clientId,
          status: initialStatus,
          publicLinkNonce: randomUUID(),
          ...(templateOrgId ? { organizationId: templateOrgId } : {}),
          phases: templateId
            ? {
                create: templatePhaseRows.map((p) => ({
                  name: p.name,
                  order: p.order,
                  amount: p.amount,
                  status: 'pending',
                })),
              }
            : phases?.length
              ? {
                  create: phases.map((phase) => ({
                    name: phase.name,
                    order: phase.order,
                    amount: phase.amount,
                    status: 'pending',
                  })),
                }
              : undefined,
        },
        include: {
          phases: { orderBy: { order: 'asc' } },
          organization: { select: { name: true } },
        },
      });

      if (templateId) {
        for (const tplPhase of templatePhaseRows) {
          if (!tplPhase.checklist) continue;
          const projectPhase = created.phases.find(
            (ph) => ph.name === tplPhase.name && ph.order === tplPhase.order,
          );
          if (!projectPhase) continue;
          await tx.phaseChecklist.create({
            data: {
              phaseId: projectPhase.id,
              source: 'template',
              items: tplPhase.checklist as Prisma.InputJsonValue,
            },
          });
        }
      } else if (phases?.length) {
        for (const manualPhase of phases) {
          const checklistItems = (manualPhase as any).checklist as
            | Array<{ label?: string; requiresPhoto?: boolean; order?: number }>
            | undefined;
          if (!Array.isArray(checklistItems) || checklistItems.length === 0) {
            continue;
          }

          const projectPhase = created.phases.find(
            (ph) =>
              ph.name === manualPhase.name && ph.order === manualPhase.order,
          );
          if (!projectPhase) continue;

          const normalized = checklistItems
            .map((item, idx) => ({
              label: String(item?.label ?? '').trim(),
              requiresPhoto: item?.requiresPhoto === true,
              order:
                typeof item?.order === 'number' && Number.isFinite(item.order)
                  ? item.order
                  : idx + 1,
            }))
            .filter((item) => item.label.length > 0);

          if (!normalized.length) continue;

          await tx.phaseChecklist.create({
            data: {
              phaseId: projectPhase.id,
              source: 'template',
              items: normalized as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }

      return created;
    });

    this.eventEmitter.emit('project.created', {
      projectId: project.id,
      clientId,
      createdByAdmin,
    });

    if (initialStatus !== 'draft') {
      this.eventEmitter.emit('project.status_changed', {
        projectId: project.id,
        from: 'draft',
        to: initialStatus,
      });
    }

    await this.invalidateProjectListCache();

    return this.formatResponse(project);
  }

  /**
   * Lista projetos com filtros opcionais.
   *  - clientId: limita a projetos cujo dono é o cliente passado.
   *  - workerId + workerAccessTier: filtro no app worker (restricted vs standard).
   *  - noContract: limita a projetos sem contrato (pool de matching).
   */
  async findAll(params: {
    clientId?: string;
    workerId?: string;
    workerAccessTier?: WorkerAccessTier;
    workerOrganizationIds?: string[];
    status?: ProjectStatus;
    noContract?: boolean;
    /** Apenas projetos sem atribuições ativas (admin / relatórios). */
    noAssignments?: boolean;
    /** Exclui draft, closed, rejected (admin). Ignorado se `status` vier preenchido. */
    activeNonTerminal?: boolean;
    skip?: number;
    take?: number;
    /** Paginação cursor-based (`id` do último item da página anterior). */
    cursor?: string;
  }) {
    const cacheKey = `projects:list:${stableCacheSegment(params)}`;
    return this.cache.cacheGet(cacheKey, 60, () => this.findAllUncached(params));
  }

  private async findAllUncached(params: {
    clientId?: string;
    workerId?: string;
    workerAccessTier?: WorkerAccessTier;
    workerOrganizationIds?: string[];
    status?: ProjectStatus;
    noContract?: boolean;
    noAssignments?: boolean;
    activeNonTerminal?: boolean;
    skip?: number;
    take?: number;
    cursor?: string;
  }) {
    const where: Prisma.ProjectWhereInput = {};

    if (params.clientId) where.clientId = params.clientId;

    if (params.noAssignments) {
      where.assignments = { none: { removedAt: null } };
    }

    if (params.noContract) {
      where.contract = null;
    } else if (params.workerId && params.workerAccessTier) {
      if (params.workerAccessTier === WorkerAccessTier.restricted) {
        where.OR = [
          {
            assignments: {
              some: { workerId: params.workerId, removedAt: null },
            },
          },
          { contract: { workerId: params.workerId } },
        ];
      } else {
        const orgIds = params.workerOrganizationIds ?? [];
        where.OR = [
          { contract: { workerId: params.workerId } },
          {
            assignments: {
              some: { workerId: params.workerId, removedAt: null },
            },
          },
          ...(orgIds.length ? [{ organizationId: { in: orgIds } }] : []),
        ];
      }
    } else if (params.workerId) {
      where.OR = [
        { contract: { workerId: params.workerId } },
        {
          assignments: {
            some: { workerId: params.workerId, removedAt: null },
          },
        },
      ];
    }

    if (params.status) {
      where.status = params.status;
    } else if (params.activeNonTerminal) {
      where.status = {
        notIn: [
          ProjectStatus.draft,
          ProjectStatus.closed,
          ProjectStatus.rejected,
        ],
      };
    }

    const takeRaw = params.take ?? 20;
    const take = params.cursor
      ? Math.min(Math.max(takeRaw, 1), 50)
      : Math.min(Math.max(takeRaw, 1), 100);

    /** Listagem: apenas campos de card + fases resumidas (sem evidências/comentários/checklists). */
    const listProjectSelect = {
      id: true,
      title: true,
      status: true,
      budget: true,
      location: true,
      deadline: true,
      createdAt: true,
      clientId: true,
      organizationId: true,
      publicLinkNonce: true,
      publicPortalEmail: true,
      publicPortalName: true,
      publicPortalIdentifiedAt: true,
      workerVisibleLabelIds: true,
      client: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
      phases: {
        orderBy: { order: 'asc' as const },
        select: {
          id: true,
          name: true,
          status: true,
          order: true,
          amount: true,
        },
      },
      contract: {
        select: {
          id: true,
          workerId: true,
          totalAmount: true,
          signedAt: true,
          worker: {
            select: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
          escrow: { select: { id: true, status: true } },
        },
      },
      assignments: {
        where: { removedAt: null },
        select: {
          id: true,
          workerId: true,
          role: true,
          removedAt: true,
          worker: {
            select: {
              user: { select: { name: true } },
            },
          },
        },
      },
      _count: {
        select: {
          assignments: {
            where: { removedAt: null },
          },
        },
      },
    } satisfies Prisma.ProjectSelect;

    if (params.cursor) {
      let rows;
      try {
        rows = await this.prisma.project.findMany({
          where,
          take: take + 1,
          skip: 1,
          cursor: { id: params.cursor },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: listProjectSelect,
        });
      } catch {
        throw new BadRequestException(
          'Cursor de paginação inválido ou projeto já não existe.',
        );
      }
      const hasMore = rows.length > take;
      const slice = hasMore ? rows.slice(0, take) : rows;
      const nextCursor =
        hasMore && slice.length > 0 ? slice[slice.length - 1]!.id : null;
      return {
        data: slice.map((p) =>
          this.formatResponse(p, params.workerId),
        ),
        nextCursor,
        take,
      };
    }

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip: params.skip ?? 0,
        take,
        orderBy: { createdAt: 'desc' },
        select: listProjectSelect,
      }),
      this.prisma.project.count({ where }),
    ]);

    return {
      data: projects.map((p) =>
        this.formatResponse(p, params.workerId),
      ),
      total,
      skip: params.skip ?? 0,
      take,
    };
  }

  /**
   * Busca um projeto pelo ID.
   * Quando `viewerKey` é passado e o viewer é o cliente dono, inclui `myRating`.
   */
  async findOne(id: string, viewerKey?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        phases: {
          orderBy: { order: 'asc' },
          include: {
            evidences: {
              select: { id: true, type: true, url: true, uploadedAt: true },
            },
            assignedWorker: {
              select: {
                id: true,
                user: { select: { id: true, name: true, avatarUrl: true } },
              },
            },
          },
        },
        contract: {
          include: {
            worker: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
            escrow: { select: { id: true, status: true } },
          },
        },
        client: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        organization: { select: { id: true, name: true } },
        assignments: {
          where: { removedAt: null },
          include: {
            worker: {
              select: {
                user: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    if (!viewerKey?.trim()) {
      return this.formatResponse(project);
    }

    const viewer = await this.requireAppUser(viewerKey);

    if (viewer.role === UserRole.worker) {
      await this.assertWorkerProjectVisibility(
        project.id,
        {
          organizationId: project.organizationId,
          contract: project.contract,
        },
        viewer.id,
      );
      const workerRow = await this.findWorkerForAppUser(viewer.id);
      return this.formatResponse(project, workerRow?.id);
    }

    const base = this.formatResponse(project);

    if (viewer.role !== UserRole.client || viewer.id !== project.clientId) {
      return base;
    }

    const row = await this.prisma.workerRating.findFirst({
      where: { projectId: id, userId: viewer.id },
      select: { score: true, feedback: true },
    });

    return {
      ...base,
      myRating: row
        ? { score: row.score, feedback: row.feedback ?? null }
        : null,
    };
  }

  /**
   * Atualiza dados do projeto (não muda status).
   */
  async update(id: string, userKey: string, dto: UpdateProjectDto) {
    const appUser = await this.requireAppUser(userKey);
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    if (project.clientId !== appUser.id && appUser.role !== 'admin') {
      throw new ForbiddenException('Você não é o dono deste projeto');
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...dto,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      },
      include: {
        phases: { orderBy: { order: 'asc' } },
      },
    });

    await this.invalidateProjectListCache();

    return this.formatResponse(updated);
  }

  /**
   * Atualiza o status do projeto usando a state machine.
   * Valida a transição antes de executar.
   */
  async updateStatus(id: string, userKey: string, dto: UpdateStatusDto) {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    const { event } = dto;
    const currentStatus = project.status;

    // Validar transição na state machine
    const nextStatus = getNextStatus(currentStatus, event);

    if (!nextStatus) {
      const available = getAvailableEvents(currentStatus).join(', ');
      throw new BadRequestException(
        `Transição inválida: '${event}' não é permitida a partir do status '${currentStatus}'. ` +
          `Eventos disponíveis: [${available}]`,
      );
    }

    const appUser = await this.requireAppUser(userKey);

    if (event === 'READY') {
      if (appUser.role !== 'admin') {
        throw new ForbiddenException(
          'Apenas administradores podem publicar uma obra para matching.',
        );
      }
    }

    // Atualizar status
    const updated = await this.prisma.project.update({
      where: { id },
      data: { status: nextStatus as ProjectStatus },
      include: {
        phases: { orderBy: { order: 'asc' } },
        contract: true,
      },
    });

    this.eventEmitter.emit('project.status_changed', {
      projectId: id,
      from: currentStatus,
      to: nextStatus as ProjectStatus,
    });

    await this.invalidateProjectListCache();

    return this.formatResponse(updated);
  }

  /**
   * Avança o status manualmente para projetos sem fases (somente admin).
   * Permite ir de in_execution → closing → closed sem depender de fases concluídas.
   */
  async advanceStatusManual(
    projectId: string,
    userKey: string,
    targetStatus: 'closing' | 'closed',
  ) {
    const appUser = await this.requireAppUser(userKey);
    if (appUser.role !== 'admin') {
      throw new ForbiddenException('Apenas administradores podem avançar o status manualmente.');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { phases: { select: { id: true } } },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    if (project.phases.length > 0) {
      throw new BadRequestException(
        'Este projeto tem fases. O status avança automaticamente quando todas as fases forem concluídas.',
      );
    }

    const allowedTransitions: Record<string, string[]> = {
      in_execution: ['closing'],
      closing: ['closed'],
    };

    if (!allowedTransitions[project.status]?.includes(targetStatus)) {
      throw new BadRequestException(
        `Não é possível avançar de '${project.status}' para '${targetStatus}'.`,
      );
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { status: targetStatus as ProjectStatus },
      include: { phases: true, contract: true },
    });

    this.eventEmitter.emit('project.status_changed', {
      projectId,
      from: project.status,
      to: targetStatus as ProjectStatus,
    });

    await this.invalidateProjectListCache();

    return this.formatResponse(updated);
  }

  /**
   * Cliente avalia o trabalhador após o projeto (uma avaliação por projeto/cliente).
   */
  async rateWorker(projectId: string, userKey: string, dto: RateProjectDto) {
    const appUser = await this.requireAppUser(userKey);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { contract: true },
    });

    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    if (project.clientId !== appUser.id) {
      throw new ForbiddenException('Apenas o cliente do projeto pode avaliar');
    }

    if (!project.contract) {
      throw new BadRequestException('Projeto sem contrato/worker para avaliar');
    }

    if (project.status !== ProjectStatus.closed) {
      throw new BadRequestException(
        'Só é possível avaliar após o projeto estar encerrado.',
      );
    }

    const workerId = project.contract.workerId;

    const rating = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workerRating.findFirst({
        where: { projectId, userId: appUser.id },
      });

      if (existing) {
        throw new BadRequestException('Você já avaliou este projeto');
      }

      const created = await tx.workerRating.create({
        data: {
          workerId,
          projectId,
          userId: appUser.id,
          score: dto.score,
          feedback: dto.feedback,
        },
      });

      const agg = await tx.workerRating.aggregate({
        where: { workerId },
        _avg: { score: true },
      });

      const avgScore = agg._avg.score ?? dto.score;

      await tx.worker.update({
        where: { id: workerId },
        data: { rating: avgScore },
      });

      return created;
    });

    this.eventEmitter.emit('worker.rated', {
      workerId,
      projectId,
      score: dto.score,
    });

    return rating;
  }

  /**
   * Remove um projeto (apenas draft).
   */
  async remove(id: string, userKey: string) {
    const appUser = await this.requireAppUser(userKey);
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    if (project.clientId !== appUser.id && appUser.role !== 'admin') {
      throw new ForbiddenException('Você não é o dono deste projeto');
    }

    if (project.status !== 'draft') {
      throw new BadRequestException(
        'Apenas projetos em status "draft" podem ser removidos',
      );
    }

    await this.prisma.project.delete({ where: { id } });

    await this.invalidateProjectListCache();

    return { message: 'Projeto removido com sucesso' };
  }

  /**
   * Linha do tempo agregada (cursor pagination). Filtra por organização + papel no projeto.
   */
  async getTimeline(
    projectId: string,
    userKey: string,
    cursor?: string,
    limitParam?: number,
    typesCsv?: string,
  ) {
    const appUser = await this.requireAppUser(userKey);
    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        phases: { orderBy: { order: 'asc' }, select: { id: true, name: true, order: true } },
        contract: {
          include: {
            worker: {
              include: {
                user: { select: { id: true, name: true, avatarUrl: true, role: true } },
              },
            },
            escrow: {
              include: { payments: true },
            },
          },
        },
        client: { select: { id: true, name: true, avatarUrl: true, role: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    await this.assertTimelineProjectAccess(project, appUser.id, appUser.role);

    const phaseById = new Map(project.phases.map((p) => [p.id, p]));
    const phaseIds = project.phases.map((p) => p.id);

    const fallbackPhase = project.phases[0] ?? {
      id: project.id,
      name: project.title,
      order: 0,
    };

    const [evidences, comments, phaseNotifs, escrowRow] = await Promise.all([
      this.prisma.phaseEvidence.findMany({
        where: { phase: { projectId } },
        include: {
          phase: { select: { id: true, name: true, order: true } },
          uploader: { select: { id: true, name: true, avatarUrl: true, role: true } },
        },
      }),
      this.prisma.evidenceComment.findMany({
        where: {
          deletedAt: null,
          evidence: { phase: { projectId } },
        },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true, role: true } },
          evidence: {
            include: {
              phase: { select: { id: true, name: true, order: true } },
            },
          },
        },
      }),
      phaseIds.length
        ? this.prisma.notification.findMany({
            where: {
              entityType: 'phase',
              entityId: { in: phaseIds },
              type: {
                in: ['phase_started', 'phase_validated', 'phase_rejected'],
              },
            },
            select: {
              id: true,
              type: true,
              entityId: true,
              createdAt: true,
              data: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.escrowTxn.findFirst({
        where: { contract: { projectId } },
        include: { payments: true },
      }),
    ]);

    const workerUser = project.contract?.worker?.user ?? null;
    const clientUser = project.client;

    const events: TimelineEvent[] = [];

    for (const ev of evidences) {
      events.push({
        id: `ev-${ev.id}`,
        type: 'evidence_uploaded',
        timestamp: ev.uploadedAt.toISOString(),
        actor: this.toTimelineActor(ev.uploader),
        phase: {
          id: ev.phase.id,
          name: ev.phase.name,
          order: ev.phase.order,
        },
        evidence: {
          id: ev.id,
          fileUrl: ev.url,
          annotationData: ev.annotationData ?? null,
          latitude: ev.latitude ?? null,
          longitude: ev.longitude ?? null,
        },
        metadata: { mimeType: ev.type },
      });
    }

    for (const c of comments) {
      events.push({
        id: `cm-${c.id}`,
        type: 'worker_comment',
        timestamp: c.createdAt.toISOString(),
        actor: this.toTimelineActor(c.author),
        phase: {
          id: c.evidence.phase.id,
          name: c.evidence.phase.name,
          order: c.evidence.phase.order,
        },
        comment: c.content,
        metadata: {
          commentId: c.id,
          evidenceId: c.evidenceId,
          voiceUrl: c.voiceUrl ?? null,
        },
      });
    }

    const phaseNotifDedup = new Map<string, (typeof phaseNotifs)[0]>();
    for (const n of phaseNotifs) {
      const key = `${n.type}:${n.entityId}`;
      const prev = phaseNotifDedup.get(key);
      if (!prev || n.createdAt < prev.createdAt) {
        phaseNotifDedup.set(key, n);
      }
    }

    for (const n of phaseNotifDedup.values()) {
      const phaseEntityId = n.entityId;
      if (!phaseEntityId) continue;
      const phase = phaseById.get(phaseEntityId);
      if (!phase) continue;

      const tlType = this.phaseNotificationToTimelineType(n.type);
      if (!tlType) continue;

      const actor = this.actorForPhaseNotification(
        tlType,
        clientUser,
        workerUser,
      );
      if (!actor) continue;

      events.push({
        id: `nt-${n.id}`,
        type: tlType,
        timestamp: n.createdAt.toISOString(),
        actor,
        phase: { id: phase.id, name: phase.name, order: phase.order },
        metadata: {
          notificationId: n.id,
          source: 'notification',
          ...(typeof n.data === 'object' && n.data ? (n.data as object) : {}),
        },
      });
    }

    const paymentActors = await this.resolvePaymentRecipientActors(escrowRow?.payments ?? []);

    for (const pay of escrowRow?.payments ?? []) {
      if (!pay.paidAt) continue;
      const au = paymentActors.get(pay.id);
      const actor = au ? this.toTimelineActor(au) : this.toTimelineActor(clientUser);
      events.push({
        id: `pay-${pay.id}`,
        type: 'payment_released',
        timestamp: pay.paidAt.toISOString(),
        actor,
        phase: {
          id: fallbackPhase.id,
          name: fallbackPhase.name,
          order: fallbackPhase.order,
        },
        metadata: {
          paymentId: pay.id,
          amount: Number(pay.amount),
          recipientType: pay.recipientType,
          recipientId: pay.recipientId,
        },
      });
    }

    if (
      escrowRow?.releasedAt &&
      escrowRow.status === 'released' &&
      (!escrowRow.payments?.length ||
        !escrowRow.payments.some((p) => p.paidAt))
    ) {
      events.push({
        id: `esc-${escrowRow.id}`,
        type: 'payment_released',
        timestamp: escrowRow.releasedAt.toISOString(),
        actor: workerUser
          ? this.toTimelineActor(workerUser)
          : this.toTimelineActor(clientUser),
        phase: {
          id: fallbackPhase.id,
          name: fallbackPhase.name,
          order: fallbackPhase.order,
        },
        metadata: {
          escrowId: escrowRow.id,
          source: 'escrow_released',
          amount: Number(escrowRow.amount),
        },
      });
    }

    const typeFilter = this.parseTimelineTypesFilter(typesCsv);
    let list = typeFilter
      ? events.filter((e) => typeFilter.has(e.type))
      : events;

    list.sort((a, b) => {
      const tb = new Date(b.timestamp).getTime();
      const ta = new Date(a.timestamp).getTime();
      if (tb !== ta) return tb - ta;
      return b.id.localeCompare(a.id);
    });

    let startIndex = 0;
    if (cursor?.trim()) {
      const decoded = this.decodeTimelineCursor(cursor.trim());
      if (!decoded) {
        throw new BadRequestException('Cursor inválido');
      }
      const idx = list.findIndex((e) => e.id === decoded.id);
      startIndex = idx === -1 ? list.length : idx + 1;
    }

    const slice = list.slice(startIndex, startIndex + limit);
    const nextCursor =
      slice.length === limit && startIndex + limit < list.length
        ? this.encodeTimelineCursor(slice[slice.length - 1].id)
        : null;

    return { events: slice, nextCursor };
  }

  /** Filtro opcional por tipo(s) de evento (CSV). Valores inválidos são ignorados. */
  private parseTimelineTypesFilter(raw?: string): Set<TimelineEventType> | null {
    if (!raw?.trim()) return null;
    const allowed: TimelineEventType[] = [
      'phase_started',
      'evidence_uploaded',
      'phase_validated',
      'payment_released',
      'worker_comment',
      'phase_rejected',
    ];
    const valid = new Set(allowed);
    const out = new Set<TimelineEventType>();
    for (const part of raw.split(',')) {
      const t = part.trim() as TimelineEventType;
      if (valid.has(t)) out.add(t);
    }
    return out.size > 0 ? out : null;
  }

  private decodeTimelineCursor(cursor: string): { id: string } | null {
    try {
      const json = Buffer.from(cursor, 'base64url').toString('utf8');
      const v = JSON.parse(json) as { id?: string };
      if (typeof v.id !== 'string' || !v.id) return null;
      return { id: v.id };
    } catch {
      return null;
    }
  }

  private encodeTimelineCursor(eventId: string): string {
    return Buffer.from(JSON.stringify({ id: eventId }), 'utf8').toString('base64url');
  }

  private toTimelineActor(u: {
    id: string;
    name: string;
    avatarUrl: string | null;
    role: UserRole;
  }) {
    return {
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl ?? null,
      role: u.role,
    };
  }

  private phaseNotificationToTimelineType(
    type: NotificationType,
  ): TimelineEventType | null {
    switch (type) {
      case 'phase_started':
        return 'phase_started';
      case 'phase_validated':
        return 'phase_validated';
      case 'phase_rejected':
        return 'phase_rejected';
      default:
        return null;
    }
  }

  private actorForPhaseNotification(
    tlType: TimelineEventType,
    clientUser: { id: string; name: string; avatarUrl: string | null; role: UserRole },
    workerUser: { id: string; name: string; avatarUrl: string | null; role: UserRole } | null,
  ) {
    if (tlType === 'phase_started') {
      return workerUser ? this.toTimelineActor(workerUser) : this.toTimelineActor(clientUser);
    }
    if (tlType === 'phase_validated' || tlType === 'phase_rejected') {
      return this.toTimelineActor(clientUser);
    }
    return this.toTimelineActor(clientUser);
  }

  private async resolvePaymentRecipientActors(
    payments: { id: string; recipientType: string; recipientId: string }[],
  ): Promise<Map<string, { id: string; name: string; avatarUrl: string | null; role: UserRole }>> {
    type ActorRow = { id: string; name: string; avatarUrl: string | null; role: UserRole };
    const out = new Map<string, ActorRow>();
    const workerIds = payments.filter((p) => p.recipientType === 'worker').map((p) => p.recipientId);
    const userIds = payments
      .filter((p) => p.recipientType !== 'worker')
      .map((p) => p.recipientId);

    const [workers, users] = await Promise.all([
      workerIds.length
        ? this.prisma.worker.findMany({
            where: { id: { in: [...new Set(workerIds)] } },
            include: {
              user: { select: { id: true, name: true, avatarUrl: true, role: true } },
            },
          })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: [...new Set(userIds)] } },
            select: { id: true, name: true, avatarUrl: true, role: true },
          })
        : Promise.resolve([]),
    ]);

    const workerById = new Map<string, ActorRow>(
      workers.map((w) => [w.id, w.user] as [string, ActorRow]),
    );
    const userById = new Map<string, ActorRow>(
      users.map((u) => [u.id, u] as [string, ActorRow]),
    );

    for (const p of payments) {
      if (p.recipientType === 'worker') {
        const u = workerById.get(p.recipientId);
        if (u) out.set(p.id, u);
      } else {
        const u = userById.get(p.recipientId);
        if (u) out.set(p.id, u);
      }
    }

    return out;
  }

  /**
   * Admin com membership na org do projeto (igual ao relatório), com `User.role === admin`.
   */
  async ensureGalleryAdminProjectAccess(
    projectId: string,
    userKey: string,
  ): Promise<{ userId: string; organizationId: string }> {
    const appUser = await this.requireAppUser(userKey);
    if (appUser.role !== 'admin') {
      throw new ForbiddenException('Apenas administradores podem gerir links de galeria.');
    }
    return this.ensureReportProjectAccess(projectId, userKey);
  }

  /**
   * Admin (org) ou cliente dono do projeto encerrado pode gerir links de galeria públicos.
   */
  async ensureGalleryManageAccess(
    projectId: string,
    userKey: string,
  ): Promise<{ userId: string; organizationId: string }> {
    const appUser = await this.requireAppUser(userKey);

    if (appUser.role === 'admin') {
      return this.ensureGalleryAdminProjectAccess(projectId, userKey);
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        contract: {
          include: {
            worker: { select: { userId: true } },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    if (
      appUser.role === 'client' &&
      project.clientId === appUser.id &&
      project.status === ProjectStatus.closed
    ) {
      await this.assertTimelineProjectAccess(project, appUser.id, appUser.role);
      const organizationId = project.organizationId;
      if (!organizationId) {
        throw new ForbiddenException('Projeto sem organização.');
      }
      return { userId: appUser.id, organizationId };
    }

    throw new ForbiddenException('Sem permissão para gerir links de galeria.');
  }

  /**
   * Mesmo controlo de acesso que o timeline; devolve `organizationId` para relatórios e outras features escopadas à org.
   */
  async ensureReportProjectAccess(
    projectId: string,
    userKey: string,
  ): Promise<{ userId: string; organizationId: string }> {
    const appUser = await this.requireAppUser(userKey);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        contract: {
          include: {
            worker: { select: { userId: true } },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    await this.assertTimelineProjectAccess(project, appUser.id, appUser.role);

    const organizationId = project.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Projeto sem organização.');
    }

    return { userId: appUser.id, organizationId };
  }

  /** App worker: lead no contrato, atribuição ativa, ou (tier standard) membro da org do projeto. */
  private async assertWorkerProjectVisibility(
    projectId: string,
    project: {
      organizationId: string | null;
      contract: { worker: { userId: string } } | null;
    },
    workerUserId: string,
  ) {
    const worker = await this.prisma.worker.findUnique({
      where: { userId: workerUserId },
      select: { id: true, accessTier: true },
    });
    if (!worker) {
      throw new ForbiddenException('Sem permissão para ver o cronograma deste projeto.');
    }

    if (project.contract?.worker?.userId === workerUserId) {
      return;
    }

    const assigned = await this.prisma.projectAssignment.findFirst({
      where: {
        projectId,
        workerId: worker.id,
        removedAt: null,
      },
    });
    if (assigned) {
      return;
    }

    if (worker.accessTier === WorkerAccessTier.restricted) {
      throw new ForbiddenException('Sem permissão para ver o cronograma deste projeto.');
    }

    const orgId = project.organizationId;
    if (!orgId) {
      throw new ForbiddenException('Sem permissão para ver o cronograma deste projeto.');
    }

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: workerUserId, organizationId: orgId },
    });
    if (membership) {
      return;
    }

    throw new ForbiddenException('Sem permissão para ver o cronograma deste projeto.');
  }

  private async assertTimelineProjectAccess(
    project: {
      id: string;
      organizationId: string | null;
      clientId: string;
      contract: { worker: { userId: string } } | null;
    },
    userId: string,
    userRole: UserRole,
  ) {
    if (userRole === UserRole.worker) {
      await this.assertWorkerProjectVisibility(
        project.id,
        {
          organizationId: project.organizationId,
          contract: project.contract,
        },
        userId,
      );
      return;
    }

    const orgId = project.organizationId;
    const isOwnerClient = userRole === 'client' && project.clientId === userId;
    const isProjectParticipant = isOwnerClient;

    // Compatibilidade com dados antigos (sem organizationId): mantém o acesso
    // para os participantes legítimos até o backfill completo de multi-tenancy.
    if (!orgId) {
      if (isProjectParticipant || userRole === 'admin') {
        return;
      }
      throw new ForbiddenException('Sem permissão para ver o cronograma deste projeto.');
    }

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId, organizationId: orgId },
    });

    if (membership?.role === 'admin') {
      return;
    }

    if (membership && isProjectParticipant) {
      return;
    }

    // Compatibilidade para contas antigas sem membership, mas já vinculadas ao projeto.
    if (!membership && isProjectParticipant) {
      return;
    }

    throw new ForbiddenException('Sem permissão para ver o cronograma deste projeto.');
  }

  // ─── Portal web do cliente (link público) ─────────────────

  private getProjectLinkSecret(): string {
    const dedicated = process.env.OX_PROJECT_LINK_SECRET?.trim();
    if (dedicated) return dedicated;
    const jwt = process.env.JWT_SECRET?.trim();
    if (jwt) return jwt;
    throw new InternalServerErrorException(
      'Defina OX_PROJECT_LINK_SECRET (ou JWT_SECRET) para links públicos de projeto.',
    );
  }

  /**
   * Base URL do portal web (Next.js ox-admin) onde existe `/p/[token]` (rota curta; `/project/[token]` redireciona).
   * Usa apenas CLIENT_PORTAL_URL — não reutilizar APP_PUBLIC_URL (costuma ser a própria API / uploads).
   */
  private getClientPortalBaseUrl(): string | null {
    const raw = process.env.CLIENT_PORTAL_URL?.trim();
    if (!raw) return null;
    return raw.replace(/\/$/, '');
  }

  /** Link partilhável com o cliente (token assinado, compatível com GET /projects/public/:token). */
  private buildClientPortalUrl(projectId: string, publicLinkNonce: string): string | null {
    const base = this.getClientPortalBaseUrl();
    if (!base) return null;
    const token = this.signPublicProjectToken(projectId, publicLinkNonce);
    return `${base}/p/${encodeURIComponent(token)}`;
  }

  /** Token URL-safe: `{projectId}.{base64url(HMAC(projectId:nonce))}` */
  signPublicProjectToken(projectId: string, nonce: string): string {
    const sig = createHmac('sha256', this.getProjectLinkSecret())
      .update(`${projectId}:${nonce}`)
      .digest('base64url');
    return `${projectId}.${sig}`;
  }

  async resolveProjectIdFromPublicToken(token: string): Promise<string> {
    const t = token?.trim();
    if (!t) throw new BadRequestException('Token em falta.');
    const dot = t.indexOf('.');
    if (dot <= 0) throw new ForbiddenException('Link inválido.');
    const projectId = t.slice(0, dot);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, publicLinkNonce: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    const expected = this.signPublicProjectToken(project.id, project.publicLinkNonce);
    const a = Buffer.from(t, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Link inválido ou revogado.');
    }
    return project.id;
  }

  async getPublicProjectView(token: string) {
    const projectId = await this.resolveProjectIdFromPublicToken(token);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        title: true,
        status: true,
        location: true,
        createdAt: true,
        organization: { select: { name: true, logoUrl: true } },
        client: { select: { name: true } },
        directEvidences: {
          select: { id: true, url: true, type: true, uploadedAt: true },
          orderBy: { uploadedAt: 'asc' },
        },
        phases: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            name: true,
            status: true,
            order: true,
            evidences: {
              select: { id: true, url: true, type: true, uploadedAt: true },
              orderBy: { uploadedAt: 'asc' },
            },
            comments: {
              select: { id: true, authorName: true, body: true, createdAt: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    if (!project) throw new NotFoundException();

    const pendingInvoiceStatuses: InvoiceStatus[] = [
      InvoiceStatus.sent,
      InvoiceStatus.overdue,
    ];
    const invoices = await this.prisma.invoice.findMany({
      where: {
        projectId,
        status: { in: pendingInvoiceStatuses },
      },
      select: {
        id: true,
        number: true,
        totalAmount: true,
        dueDate: true,
        status: true,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });

    const rawName = project.client?.name?.trim();
    const clientDisplayName =
      rawName && rawName.length > 0 ? rawName.split(/\s+/)[0]! : 'Cliente';

    return {
      title: project.title,
      status: project.status,
      location: project.location ?? null,
      createdAt: project.createdAt.toISOString(),
      organizationName: project.organization?.name ?? null,
      organizationLogo: project.organization?.logoUrl ?? null,
      clientDisplayName,
      phases: project.phases.map((ph) => ({
        id: ph.id,
        name: ph.name,
        status: ph.status,
        order: ph.order,
        evidences: ph.evidences.map((e) => ({
          id: e.id,
          url: e.url,
          type: e.type,
          uploadedAt: e.uploadedAt.toISOString(),
        })),
        comments: ph.comments.map((c) => ({
          id: c.id,
          authorName: c.authorName,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
      })),
      directEvidences: project.directEvidences.map((e) => ({
        id: e.id,
        url: e.url,
        type: e.type,
        uploadedAt: e.uploadedAt.toISOString(),
      })),
      pendingInvoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        totalAmount: Number(inv.totalAmount),
        dueDate: inv.dueDate?.toISOString() ?? null,
        status: inv.status,
        payToken: this.invoiceService.signPublicToken(inv.id),
      })),
    };
  }

  async addPublicPhaseComment(
    token: string,
    phaseId: string,
    dto: { authorName: string; body: string },
  ) {
    const projectId = await this.resolveProjectIdFromPublicToken(token);
    const authorName = dto.authorName.trim().slice(0, 120);
    const body = dto.body.trim().slice(0, 4000);
    if (!authorName || !body) {
      throw new BadRequestException('Nome e mensagem são obrigatórios.');
    }

    const phase = await this.prisma.projectPhase.findFirst({
      where: { id: phaseId, projectId },
      select: {
        id: true,
        name: true,
        project: { select: { title: true } },
      },
    });
    if (!phase) {
      throw new NotFoundException('Fase não encontrada.');
    }

    const row = await this.prisma.phaseComment.create({
      data: {
        phaseId: phase.id,
        authorName,
        body,
      },
      select: {
        id: true,
        authorName: true,
        body: true,
        createdAt: true,
      },
    });

    this.eventEmitter.emit('phase.client_commented', {
      projectId,
      phaseId: phase.id,
      phaseName: phase.name,
      projectTitle: phase.project.title,
      authorName,
    });

    return {
      id: row.id,
      authorName: row.authorName,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async identifyPublicPortalViewer(token: string, dto: { email: string; name: string }) {
    const projectId = await this.resolveProjectIdFromPublicToken(token);
    const email = dto.email.trim().toLowerCase().slice(0, 320);
    const name = dto.name.trim().slice(0, 200);
    if (!email || !name) {
      throw new BadRequestException('Email e nome são obrigatórios.');
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        publicPortalEmail: email,
        publicPortalName: name,
        publicPortalIdentifiedAt: new Date(),
      },
    });

    return { ok: true as const };
  }

  async getPublicLinkForAdmin(projectId: string, userKey: string) {
    await this.ensureGalleryAdminProjectAccess(projectId, userKey);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, publicLinkNonce: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    return {
      token: this.signPublicProjectToken(project.id, project.publicLinkNonce),
    };
  }

  async regeneratePublicLink(projectId: string, userKey: string) {
    await this.ensureGalleryAdminProjectAccess(projectId, userKey);
    const nonce = randomUUID();
    await this.prisma.project.update({
      where: { id: projectId },
      data: { publicLinkNonce: nonce },
    });
    return { token: this.signPublicProjectToken(projectId, nonce) };
  }

  private normalizeWorkerVisibleLabelIds(raw: unknown): string[] {
    if (raw == null) return [];
    let arr: unknown[] = [];
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (typeof raw === 'string') {
      try {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) arr = p;
      } catch {
        return [];
      }
    }
    const out: string[] = [];
    for (const x of arr) {
      const s = typeof x === 'string' ? x : String(x);
      if (ALLOWED_WORKER_VISIBLE_LABEL_IDS.has(s) && !out.includes(s)) {
        out.push(s);
      }
    }
    return out;
  }

  /**
   * Etiquetas visíveis ao cliente (definidas por workers com acesso ao projeto).
   */
  async patchWorkerVisibleLabels(
    projectId: string,
    userKey: string,
    labelIds: string[],
  ) {
    const viewer = await this.requireAppUser(userKey);
    if (viewer.role !== UserRole.worker) {
      throw new ForbiddenException('Apenas trabalhadores podem atualizar estas etiquetas.');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        contract: {
          include: { worker: { select: { userId: true } } },
        },
      },
    });
    if (!project) {
      throw new NotFoundException('Projeto não encontrado');
    }

    await this.assertWorkerProjectVisibility(
      project.id,
      {
        organizationId: project.organizationId,
        contract: project.contract,
      },
      viewer.id,
    );

    const normalized = this.normalizeWorkerVisibleLabelIds(labelIds);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { workerVisibleLabelIds: normalized },
    });

    return { workerVisibleLabelIds: normalized };
  }

  private async collectRecentWorkImageRows(
    projectIds: string[],
    limit: number,
  ) {
    if (projectIds.length === 0) return [];

    const cap = Math.min(Math.max(limit * 3, limit), 200);

    const [direct, phase] = await Promise.all([
      this.prisma.projectEvidence.findMany({
        where: {
          projectId: { in: projectIds },
          type: { startsWith: 'image/' },
        },
        orderBy: { uploadedAt: 'desc' },
        take: cap,
        include: { uploader: { select: { name: true } } },
      }),
      this.prisma.phaseEvidence.findMany({
        where: {
          phase: { projectId: { in: projectIds } },
          type: { startsWith: 'image/' },
        },
        orderBy: { uploadedAt: 'desc' },
        take: cap,
        include: {
          uploader: { select: { name: true } },
          phase: { select: { id: true, projectId: true } },
        },
      }),
    ]);

    type Row = {
      id: string;
      url: string;
      type: string;
      uploadedAt: string;
      capturedAt: string | null;
      uploaderName: string | null;
      projectId: string;
      source: 'direct' | 'phase';
      phaseId?: string;
    };

    const rows: Row[] = [];
    for (const e of direct) {
      rows.push({
        id: e.id,
        url: e.url,
        type: e.type,
        uploadedAt: e.uploadedAt.toISOString(),
        capturedAt: e.capturedAt?.toISOString() ?? null,
        uploaderName: e.uploader?.name ?? null,
        projectId: e.projectId,
        source: 'direct',
      });
    }
    for (const e of phase) {
      rows.push({
        id: e.id,
        url: e.url,
        type: e.type,
        uploadedAt: e.uploadedAt.toISOString(),
        capturedAt: e.capturedAt?.toISOString() ?? null,
        uploaderName: e.uploader?.name ?? null,
        projectId: e.phase.projectId,
        source: 'phase',
        phaseId: e.phase.id,
      });
    }

    rows.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );

    return rows.slice(0, limit);
  }

  /**
   * Últimas imagens nos projetos do cliente (qualquer worker).
   */
  async listRecentWorkImagesForClient(clientUserKey: string, limit = 30) {
    const viewer = await this.requireAppUser(clientUserKey);
    if (viewer.role !== UserRole.client) {
      throw new ForbiddenException('Apenas clientes.');
    }
    const projects = await this.prisma.project.findMany({
      where: { clientId: viewer.id },
      select: { id: true },
      take: 400,
    });
    const projectIds = projects.map((p) => p.id);
    return this.collectRecentWorkImageRows(projectIds, limit);
  }

  /**
   * Últimas imagens (evidência direta + por fase) em qualquer projeto visível ao worker,
   * de qualquer membro da equipa. Usado no feed “Atividade” do app worker.
   */
  async listRecentWorkImagesForWorker(workerUserKey: string, limit = 30) {
    const workerRow = await this.findWorkerForAppUser(workerUserKey);
    if (!workerRow) return [];

    const orgIds = await this.findOrganizationIdsForUser(workerUserKey);

    const where: Prisma.ProjectWhereInput = {};
    if (workerRow.accessTier === WorkerAccessTier.restricted) {
      where.OR = [
        {
          assignments: {
            some: { workerId: workerRow.id, removedAt: null },
          },
        },
        { contract: { workerId: workerRow.id } },
      ];
    } else {
      where.OR = [
        { contract: { workerId: workerRow.id } },
        {
          assignments: {
            some: { workerId: workerRow.id, removedAt: null },
          },
        },
        ...(orgIds.length ? [{ organizationId: { in: orgIds } }] : []),
      ];
    }

    const projects = await this.prisma.project.findMany({
      where,
      select: { id: true },
      take: 400,
    });
    const projectIds = projects.map((p) => p.id);
    return this.collectRecentWorkImageRows(projectIds, limit);
  }

  /**
   * Feed de imagens para cliente ou worker (delega conforme o papel).
   */
  async listRecentWorkImagesForViewer(userKey: string, limit = 30) {
    const viewer = await this.requireAppUser(userKey);
    if (viewer.role === UserRole.client) {
      return this.listRecentWorkImagesForClient(userKey, limit);
    }
    if (viewer.role === UserRole.worker) {
      return this.listRecentWorkImagesForWorker(userKey, limit);
    }
    throw new ForbiddenException('Indisponível para este perfil.');
  }

  // ─── Helpers ───────────────────────────────────────────

  private formatResponse(project: any, viewerWorkerId?: string) {
    const {
      publicLinkNonce: _omitPublicLinkNonce,
      assignments: rawAssignments,
      workerVisibleLabelIds: rawWorkerVisibleLabelIds,
      ...safeProject
    } = project;
    const availableEvents = getAvailableEvents(project.status);

    const activeAssignments = (rawAssignments ?? []).filter(
      (a: any) => !a.removedAt,
    );

    let assignmentRole: string | null = null;
    if (viewerWorkerId) {
      const mine = activeAssignments.find(
        (a: any) => a.workerId === viewerWorkerId,
      );
      if (mine) {
        assignmentRole = mine.role;
      } else if (project.contract?.workerId === viewerWorkerId) {
        assignmentRole = 'lead_worker';
      }
    }

    const teamIds = new Set<string>();
    for (const a of activeAssignments) {
      teamIds.add(a.workerId);
    }
    if (project.contract?.workerId) {
      teamIds.add(project.contract.workerId);
    }
    const teamSize = teamIds.size;

    const leadAssignment = activeAssignments.find(
      (a: any) => a.role === 'lead_worker',
    );
    let leadWorkerName: string | null = null;
    if (leadAssignment?.worker?.user?.name) {
      leadWorkerName = leadAssignment.worker.user.name;
    } else if (project.contract?.worker?.user?.name) {
      leadWorkerName = project.contract.worker.user.name;
    }

    return {
      ...safeProject,
      publicUrl: this.buildClientPortalUrl(project.id, project.publicLinkNonce),
      budget: Number(project.budget),
      deadline: project.deadline?.toISOString() ?? null,
      createdAt: project.createdAt.toISOString(),
      availableEvents,
      phases: project.phases?.map((phase: any) => ({
        ...phase,
        amount: Number(phase.amount),
      })),
      teamSize,
      leadWorkerName,
      workerVisibleLabelIds:
        this.normalizeWorkerVisibleLabelIds(rawWorkerVisibleLabelIds),
      ...(viewerWorkerId ? { assignmentRole } : {}),
    };
  }
}
