import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  OrganizationCreatedPayload,
  UserCreatedPayload,
  ProjectCreatedPayload,
  ProjectStatusChangedPayload,
} from '../../common/events/domain-events';
import { HubspotQueue } from './hubspot.queue';

@Injectable()
export class HubspotListener {
  private readonly logger = new Logger(HubspotListener.name);

  constructor(
    private readonly queue: HubspotQueue,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('organization.created')
  async onOrganizationCreated(payload: OrganizationCreatedPayload) {
    try {
      await this.queue.add('sync-company', { organizationId: payload.organizationId });
    } catch (e) {
      this.logger.error(`organization.created → sync-company failed: ${String(e)}`);
    }
  }

  @OnEvent('user.created')
  async onUserCreated(payload: UserCreatedPayload) {
    try {
      const membership = await this.prisma.organizationMember.findFirst({
        where: { userId: payload.userId },
        orderBy: { joinedAt: 'asc' },
        select: { organization: { select: { hubspotCompanyId: true } } },
      });
      const hubspotCompanyId = membership?.organization?.hubspotCompanyId ?? undefined;
      await this.queue.add('sync-contact', { userId: payload.userId, hubspotCompanyId });
    } catch (e) {
      this.logger.error(`user.created → sync-contact failed: ${String(e)}`);
    }
  }

  @OnEvent('project.created')
  async onProjectCreated(payload: ProjectCreatedPayload) {
    try {
      await this.queue.add('sync-deal', { projectId: payload.projectId });
    } catch (e) {
      this.logger.error(`project.created → sync-deal failed: ${String(e)}`);
    }
  }

  @OnEvent('project.status_changed')
  async onProjectStatusChanged(payload: ProjectStatusChangedPayload) {
    try {
      await this.queue.add('sync-deal', { projectId: payload.projectId });
    } catch (e) {
      this.logger.error(`project.status_changed → sync-deal failed: ${String(e)}`);
    }
  }

  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: { invoiceId: string }) {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: payload.invoiceId },
        select: { projectId: true },
      });
      if (invoice?.projectId) {
        await this.queue.add('sync-deal', { projectId: invoice.projectId });
      }
    } catch (e) {
      this.logger.error(`invoice.paid → sync-deal failed: ${String(e)}`);
    }
  }

  // ── Fase 4: Timeline Activities ────────────────────────────────────────────

  @OnEvent('phase.evidence_uploaded')
  async onEvidenceUploaded(payload: { projectId: string; phaseId: string }) {
    try {
      await this.queue.add('timeline-activity', {
        projectId: payload.projectId,
        body: 'Evidência enviada na fase do projeto.',
      });
    } catch (e) {
      this.logger.error(`phase.evidence_uploaded → timeline-activity failed: ${String(e)}`);
    }
  }

  @OnEvent('worker.assigned')
  async onWorkerAssigned(payload: { projectId: string; workerId: string }) {
    try {
      const worker = await this.prisma.worker.findUnique({
        where: { id: payload.workerId },
        select: { user: { select: { name: true } } },
      });
      const name = worker?.user?.name ?? 'Worker';
      await this.queue.add('timeline-activity', {
        projectId: payload.projectId,
        body: `Worker "${name}" atribuído ao projeto.`,
      });
    } catch (e) {
      this.logger.error(`worker.assigned → timeline-activity failed: ${String(e)}`);
    }
  }

  @OnEvent('contract.signed')
  async onContractSigned(payload: { contractId: string }) {
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: payload.contractId },
        select: { projectId: true },
      });
      if (contract?.projectId) {
        await this.queue.add('timeline-activity', {
          projectId: contract.projectId,
          body: 'Contrato assinado digitalmente.',
        });
      }
    } catch (e) {
      this.logger.error(`contract.signed → timeline-activity failed: ${String(e)}`);
    }
  }

  @OnEvent('payment.released')
  async onPaymentReleased(payload: { escrowId: string }) {
    try {
      const escrow = await this.prisma.escrowTxn.findUnique({
        where: { id: payload.escrowId },
        select: { amount: true, contract: { select: { projectId: true } } },
      });
      const projectId = escrow?.contract?.projectId;
      if (projectId) {
        const amount = escrow?.amount ? `R$ ${Number(escrow.amount).toFixed(2)}` : '';
        await this.queue.add('timeline-activity', {
          projectId,
          body: `Pagamento liberado ao worker${amount ? ': ' + amount : ''}.`,
        });
      }
    } catch (e) {
      this.logger.error(`payment.released → timeline-activity failed: ${String(e)}`);
    }
  }
}
