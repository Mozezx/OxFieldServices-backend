import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CacheService,
  stableCacheSegment,
} from '../../cache/cache.service';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { UpdateWorkerLocationDto } from './dto/update-worker-location.dto';

@Injectable()
export class WorkersService {
  constructor(
    private prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private async invalidateWorkerListCache(): Promise<void> {
    await this.cache.invalidateByPrefix('workers:list:');
  }

  async findMe(userId: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { userId },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, avatarUrl: true },
        },
        ratings: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!worker) throw new NotFoundException('Perfil de worker não encontrado');

    return this.formatWorker(worker);
  }

  async updateMe(userId: string, dto: UpdateWorkerDto) {
    const worker = await this.prisma.worker.findUnique({ where: { userId } });
    if (!worker) throw new NotFoundException('Perfil de worker não encontrado');

    const { accessTier: _ignoredAccessTier, ...data } = dto;

    const updated = await this.prisma.worker.update({
      where: { userId },
      data,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, avatarUrl: true },
        },
      },
    });

    await this.invalidateWorkerListCache();

    return this.formatWorker(updated);
  }

  async findAll(params: { available?: boolean; skip?: number; take?: number }) {
    const cacheKey = `workers:list:${stableCacheSegment(params)}`;
    return this.cache.cacheGet(cacheKey, 120, () =>
      this.findAllUncached(params),
    );
  }

  private async findAllUncached(params: {
    available?: boolean;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (params.available !== undefined) where.available = params.available;

    const [workers, total] = await Promise.all([
      this.prisma.worker.findMany({
        where,
        skip: params.skip ?? 0,
        take: params.take ?? 20,
        orderBy: { rating: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          _count: {
            select: {
              assignments: {
                where: {
                  removedAt: null,
                  project: {
                    status: {
                      notIn: [
                        ProjectStatus.draft,
                        ProjectStatus.closed,
                        ProjectStatus.rejected,
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.worker.count({ where }),
    ]);

    return { data: workers.map((w) => this.formatWorker(w)), total };
  }

  async updateById(workerId: string, dto: UpdateWorkerDto) {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw new NotFoundException('Worker não encontrado');

    const updated = await this.prisma.worker.update({
      where: { id: workerId },
      data: dto,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, avatarUrl: true },
        },
      },
    });

    await this.invalidateWorkerListCache();

    return this.formatWorker(updated);
  }

  async findOne(workerId: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        ratings: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    if (!worker) throw new NotFoundException('Worker não encontrado');

    return this.formatWorker(worker);
  }

  async updateMyLocation(userId: string, dto: UpdateWorkerLocationDto) {
    const worker = await this.prisma.worker.findUnique({ where: { userId } });
    if (!worker) throw new NotFoundException('Perfil de worker não encontrado');

    return this.prisma.workerLocation.upsert({
      where: { workerId: worker.id },
      create: {
        workerId: worker.id,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        capturedAt: new Date(),
      },
      update: {
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        capturedAt: new Date(),
      },
    });
  }

  async listWorkersWithLocations(params: { available?: boolean; recentMinutes?: number }) {
    const where: any = {
      location: {
        isNot: null,
      },
    };

    if (params.available !== undefined) where.available = params.available;
    if (params.recentMinutes) {
      where.location = {
        is: {
          capturedAt: {
            gte: new Date(Date.now() - params.recentMinutes * 60 * 1000),
          },
        },
      };
    }

    const workers = await this.prisma.worker.findMany({
      where,
      orderBy: { rating: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        location: true,
      },
    });

    return workers.map((worker) => this.formatWorker(worker));
  }

  async assertWorkerRole(userId: string) {
    const worker = await this.prisma.worker.findUnique({ where: { userId } });
    if (!worker) throw new ForbiddenException('Apenas workers podem acessar este recurso');
    return worker;
  }

  /**
   * Equipes (crews) onde o worker é membro, com colegas e projetos em que alguém
   * da mesma equipa tem atribuição ativa.
   */
  async findMyCrewContext(userId: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!worker) {
      return { crews: [] as const, projectTeams: [] as const };
    }

    const memberships = await this.prisma.crewMember.findMany({
      where: { workerId: worker.id },
      orderBy: { crew: { name: 'asc' } },
      include: {
        crew: {
          include: {
            members: {
              orderBy: { addedAt: 'asc' },
              include: {
                worker: {
                  include: {
                    user: {
                      select: { id: true, name: true, avatarUrl: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const crews: Array<{
      id: string;
      name: string;
      description: string | null;
      members: Array<{
        workerId: string;
        name: string;
        avatarUrl: string | null;
        isMe: boolean;
      }>;
      projects: Array<{
        id: string;
        title: string;
        status: string;
        location: string;
      }>;
    }> = [];

    for (const m of memberships) {
      const { crew } = m;
      const memberWorkerIds = crew.members.map((cm) => cm.workerId);

      const projects: Array<{
        id: string;
        title: string;
        status: string;
        location: string;
      }> = [];

      if (memberWorkerIds.length > 0) {
        const assignments = await this.prisma.projectAssignment.findMany({
          where: {
            workerId: { in: memberWorkerIds },
            removedAt: null,
          },
          select: {
            project: {
              select: { id: true, title: true, status: true, location: true },
            },
          },
        });
        const seen = new Set<string>();
        for (const a of assignments) {
          const pid = a.project.id;
          if (seen.has(pid)) continue;
          seen.add(pid);
          projects.push(a.project);
        }
      }

      crews.push({
        id: crew.id,
        name: crew.name,
        description: crew.description,
        members: crew.members.map((cm) => ({
          workerId: cm.workerId,
          name: cm.worker.user?.name ?? '',
          avatarUrl: cm.worker.user?.avatarUrl ?? null,
          isMe: cm.workerId === worker.id,
        })),
        projects,
      });
    }

    const myProjectIds = new Set<string>();
    const myAssignments = await this.prisma.projectAssignment.findMany({
      where: { workerId: worker.id, removedAt: null },
      select: { projectId: true },
    });
    for (const a of myAssignments) myProjectIds.add(a.projectId);

    const myContracts = await this.prisma.contract.findMany({
      where: { workerId: worker.id },
      select: { projectId: true },
    });
    for (const c of myContracts) myProjectIds.add(c.projectId);

    const projectTeams: Array<{
      project: {
        id: string;
        title: string;
        status: string;
        location: string;
      };
      members: Array<{
        workerId: string;
        name: string;
        avatarUrl: string | null;
        isMe: boolean;
      }>;
    }> = [];

    if (myProjectIds.size > 0) {
      const projectsWithTeam = await this.prisma.project.findMany({
        where: { id: { in: [...myProjectIds] } },
        select: {
          id: true,
          title: true,
          status: true,
          location: true,
          assignments: {
            where: { removedAt: null },
            select: {
              workerId: true,
              worker: {
                select: {
                  id: true,
                  user: {
                    select: { name: true, avatarUrl: true },
                  },
                },
              },
            },
          },
          contract: {
            select: {
              workerId: true,
              worker: {
                select: {
                  id: true,
                  user: {
                    select: { name: true, avatarUrl: true },
                  },
                },
              },
            },
          },
        },
      });

      for (const p of projectsWithTeam) {
        const memberMap = new Map<
          string,
          { workerId: string; name: string; avatarUrl: string | null; isMe: boolean }
        >();

        for (const a of p.assignments) {
          memberMap.set(a.workerId, {
            workerId: a.workerId,
            name: a.worker.user?.name ?? '',
            avatarUrl: a.worker.user?.avatarUrl ?? null,
            isMe: a.workerId === worker.id,
          });
        }

        const cw = p.contract?.worker;
        if (cw && p.contract?.workerId && !memberMap.has(p.contract.workerId)) {
          memberMap.set(p.contract.workerId, {
            workerId: p.contract.workerId,
            name: cw.user?.name ?? '',
            avatarUrl: cw.user?.avatarUrl ?? null,
            isMe: p.contract.workerId === worker.id,
          });
        }

        const members = [...memberMap.values()].sort((x, y) =>
          x.name.localeCompare(y.name),
        );

        projectTeams.push({
          project: {
            id: p.id,
            title: p.title,
            status: p.status,
            location: p.location,
          },
          members,
        });
      }

      projectTeams.sort((a, b) => a.project.title.localeCompare(b.project.title));
    }

    return { crews, projectTeams };
  }

  private formatWorker(worker: any) {
    return {
      ...worker,
      rating: Number(worker.rating),
    };
  }
}
