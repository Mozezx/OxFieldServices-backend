import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhooksService } from './webhooks.service';

@Injectable()
export class WebhooksListener {
  constructor(private readonly webhooks: WebhooksService) {}

  @OnEvent('project.created')
  handleProjectCreated(payload: { projectId: string; clientId: string; createdByAdmin: boolean }) {
    return this.webhooks.dispatchForProject('project.created', payload, payload.projectId);
  }

  @OnEvent('phase.evidence_uploaded')
  handleEvidenceUploaded(payload: {
    phaseId: string;
    evidenceId: string;
    projectId: string;
  }) {
    return this.webhooks.dispatchForProject(
      'phase.evidence_uploaded',
      payload,
      payload.projectId,
    );
  }

  @OnEvent('payment.released')
  handlePaymentReleased(payload: { escrowId: string }) {
    return this.webhooks.dispatchForEscrow('payment.released', payload, payload.escrowId);
  }
}
