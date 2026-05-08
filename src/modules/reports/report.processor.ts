import {
  Processor,
  Process,
  OnQueueFailed,
  OnQueueCompleted,
} from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bull';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { ReportStatus, ReportType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { REPORT_GENERATION_QUEUE } from './reports.constants';
import type { ReportGenerationJobData } from './report-generation.job';
import {
  buildReportHtml,
  type ReportPdfProjectPayload,
} from './report-html.builder';

@Processor(REPORT_GENERATION_QUEUE)
export class ReportProcessor {
  private readonly logger = new Logger(ReportProcessor.name);
  private readonly supabase;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const url = this.config.get<string>('SUPABASE_URL');
    const key =
      this.config.get<string>('SUPABASE_SERVICE_KEY') ??
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios para relatórios.');
    }
    this.supabase = createClient(url, key);
  }

  @Process({ concurrency: 1 })
  async handle(job: Job) {
    const { reportId, projectId, organizationId, type } =
      job.data as ReportGenerationJobData;

    const bucket =
      this.config.get<string>('REPORTS_STORAGE_BUCKET') ?? 'project-reports';

    await this.prisma.projectReport.update({
      where: { id: reportId },
      data: { progress: 5, status: ReportStatus.PENDING },
    });

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        organization: { select: { name: true } },
        client: { select: { name: true } },
        phases: {
          orderBy: { order: 'asc' },
          include: {
            evidences: {
              include: {
                uploader: { select: { name: true } },
              },
            },
          },
        },
        contract: {
          include: {
            worker: { include: { user: { select: { name: true } } } },
            escrow: {
              include: {
                payments: { orderBy: { paidAt: 'desc' } },
              },
            },
          },
        },
      },
    });

    if (!project || project.organizationId !== organizationId) {
      await this.failReport(reportId, 'Projeto inválido ou organização não coincide.');
      return;
    }

    await this.prisma.projectReport.update({
      where: { id: reportId },
      data: { progress: 15 },
    });

    const payload: ReportPdfProjectPayload = {
      title: project.title,
      location: project.location,
      budget: Number(project.budget).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      organizationName: project.organization?.name ?? '—',
      clientName: project.client.name,
      workerName: project.contract?.worker?.user?.name ?? null,
      phases: project.phases.map((ph) => ({
        name: ph.name,
        order: ph.order,
        status: ph.status,
        amount: Number(ph.amount).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        evidences: ph.evidences.map((e) => ({
          url: e.url,
          type: e.type,
          uploadedAt: e.uploadedAt.toISOString(),
          uploaderName: e.uploader.name,
          aiCaption: e.aiCaption,
        })),
      })),
      payments:
        project.contract?.escrow?.payments?.map((p) => ({
          amount: Number(p.amount).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
          recipientType: p.recipientType,
          paidAt: p.paidAt?.toISOString() ?? null,
        })) ?? [],
    };

    const html = buildReportHtml(type as ReportType, payload);

    await this.prisma.projectReport.update({
      where: { id: reportId },
      data: { progress: 40 },
    });

    const pdfBuffer = await this.renderPdf(html);

    await this.prisma.projectReport.update({
      where: { id: reportId },
      data: { progress: 70 },
    });

    const path = `orgs/${organizationId}/projects/${projectId}/${reportId}.pdf`;
    const { error } = await this.supabase.storage.from(bucket).upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: 'private, max-age=3600',
    });

    if (error) {
      this.logger.error(`Storage upload failed: ${error.message}`);
      await this.failReport(reportId, error.message);
      return;
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(bucket).getPublicUrl(path);

    await this.prisma.projectReport.update({
      where: { id: reportId },
      data: {
        fileUrl: publicUrl,
        status: ReportStatus.COMPLETED,
        progress: 100,
      },
    });
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const buf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', bottom: '16mm', left: '12mm', right: '12mm' },
      });
      return Buffer.from(buf);
    } finally {
      await browser.close();
    }
  }

  private async failReport(reportId: string, reason: string) {
    this.logger.warn(`Report ${reportId} failed: ${reason}`);
    await this.prisma.projectReport.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.FAILED,
        progress: null,
      },
    });
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `Job ${job.id} failed for report ${job.data?.reportId}: ${err.message}`,
      err.stack,
    );
    const data = job.data as ReportGenerationJobData | undefined;
    if (data?.reportId) {
      void this.failReport(data.reportId, err.message);
    }
  }

  @OnQueueCompleted()
  onDone(job: Job) {
    const data = job.data as ReportGenerationJobData | undefined;
    this.logger.log(`Report job ${job.id} completed (${data?.reportId})`);
  }
}
