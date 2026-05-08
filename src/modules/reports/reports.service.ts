import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { ProjectsService } from '../projects/projects.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';
import { REPORT_GENERATION_QUEUE } from './reports.constants';
import type { ReportGenerationJobData } from './report-generation.job';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    @InjectQueue(REPORT_GENERATION_QUEUE)
    private readonly reportQueue: Queue<ReportGenerationJobData>,
  ) {}

  async create(projectId: string, userKey: string, dto: CreateReportDto) {
    const { userId, organizationId } =
      await this.projectsService.ensureReportProjectAccess(projectId, userKey);

    const report = await this.prisma.projectReport.create({
      data: {
        projectId,
        organizationId,
        type: dto.type,
        fileUrl: '',
        generatedBy: userId,
      },
    });

    await this.reportQueue.add(
      {
        reportId: report.id,
        projectId,
        organizationId,
        type: dto.type,
      },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    );

    return { reportId: report.id };
  }

  async getStatus(projectId: string, reportId: string, userKey: string) {
    const { organizationId } =
      await this.projectsService.ensureReportProjectAccess(projectId, userKey);

    const report = await this.prisma.projectReport.findFirst({
      where: { id: reportId, projectId, organizationId },
    });

    if (!report) {
      throw new NotFoundException('Relatório não encontrado');
    }

    const out: {
      status: typeof report.status;
      fileUrl?: string;
      progress?: number | null;
    } = {
      status: report.status,
    };

    if (report.status === 'COMPLETED' && report.fileUrl) {
      out.fileUrl = report.fileUrl;
    }
    if (report.progress != null) {
      out.progress = report.progress;
    }

    return out;
  }

  async listForProject(projectId: string, userKey: string) {
    const { organizationId } =
      await this.projectsService.ensureReportProjectAccess(projectId, userKey);

    const rows = await this.prisma.projectReport.findMany({
      where: { projectId, organizationId },
      orderBy: { generatedAt: 'desc' },
    });

    const userIds = [...new Set(rows.map((r) => r.generatedBy))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => {
      const u = userById.get(r.generatedBy);
      return {
        id: r.id,
        type: r.type,
        status: r.status,
        fileUrl: r.fileUrl || null,
        generatedAt: r.generatedAt.toISOString(),
        progress: r.progress,
        generatedBy: u
          ? { id: u.id, name: u.name, email: u.email }
          : { id: r.generatedBy, name: '—', email: null as string | null },
      };
    });
  }
}
