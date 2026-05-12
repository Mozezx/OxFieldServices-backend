import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HubspotService } from './hubspot.service';
import { HUBSPOT_SYNC_QUEUE } from './hubspot.constants';

@Processor(HUBSPOT_SYNC_QUEUE)
export class HubspotProcessor {
  private readonly logger = new Logger(HubspotProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hubspot: HubspotService,
  ) {}

  @Process('sync-company')
  async handleSyncCompany(job: Job<{ organizationId: string }>) {
    const org = await this.prisma.organization.findUnique({
      where: { id: job.data.organizationId },
    });
    if (!org) return;
    await this.hubspot.upsertCompany(org);
  }

  @Process('sync-contact')
  async handleSyncContact(job: Job<{ userId: string; hubspotCompanyId?: string }>) {
    const user = await this.prisma.user.findUnique({ where: { id: job.data.userId } });
    if (!user) return;
    await this.hubspot.upsertContact(user, job.data.hubspotCompanyId);
  }

  @Process('sync-deal')
  async handleSyncDeal(job: Job<{ projectId: string }>) {
    const project = await this.prisma.project.findUnique({
      where: { id: job.data.projectId },
    });
    if (!project) return;
    await this.hubspot.upsertDeal(project);
  }

  @Process('timeline-activity')
  async handleTimelineActivity(job: Job<{ projectId: string; body: string }>) {
    await this.hubspot.createActivityNote(job.data.projectId, job.data.body);
  }
}
