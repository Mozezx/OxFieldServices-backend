import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { UpdateWorkerLocationDto } from './dto/update-worker-location.dto';

@Injectable()
export class WorkersService {
  constructor(private prisma: PrismaService) {}

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

    return this.formatWorker(updated);
  }

  async findAll(params: { available?: boolean; skip?: number; take?: number }) {
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

  private formatWorker(worker: any) {
    return {
      ...worker,
      rating: Number(worker.rating),
    };
  }
}
