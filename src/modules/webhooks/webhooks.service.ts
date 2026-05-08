import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';

export type WebhookDeliveryJob = { deliveryId: string };

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly deliveryQueue: Queue<WebhookDeliveryJob>,
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

  private async getAdminOrganizationIdForWrite(userId: string): Promise<string> {
    const m = await this.prisma.organizationMember.findFirst({
      where: { userId, role: 'admin' },
      orderBy: { joinedAt: 'asc' },
      select: { organizationId: true },
    });
    if (!m) {
      throw new ForbiddenException(
        'Utilizador não pertence a nenhuma organização como admin.',
      );
    }
    return m.organizationId;
  }

  async dispatch(event: string, payload: object, organizationId: string) {
    if (!organizationId) return;

    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        organizationId,
        isActive: true,
        events: { has: event },
      },
    });

    for (const ep of endpoints) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          endpointId: ep.id,
          event,
          payload: payload as Prisma.InputJsonValue,
        },
      });
      await this.deliveryQueue.add(
        { deliveryId: delivery.id },
        { removeOnComplete: true, removeOnFail: 100 },
      );
    }
  }

  async dispatchForProject(
    event: string,
    payload: object,
    projectId: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const orgId = project?.organizationId;
    if (orgId) await this.dispatch(event, payload, orgId);
  }

  async dispatchForPhase(event: string, payload: object, phaseId: string) {
    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
      select: {
        project: { select: { organizationId: true } },
      },
    });
    const orgId = phase?.project.organizationId;
    if (orgId) await this.dispatch(event, payload, orgId);
  }

  async dispatchForEscrow(event: string, payload: object, escrowId: string) {
    const escrow = await this.prisma.escrowTxn.findUnique({
      where: { id: escrowId },
      select: {
        contract: {
          select: { project: { select: { organizationId: true } } },
        },
      },
    });
    const orgId = escrow?.contract.project.organizationId;
    if (orgId) await this.dispatch(event, payload, orgId);
  }

  async createEndpoint(userKey: string, dto: CreateWebhookEndpointDto) {
    const userId = await this.resolveUserId(userKey);
    const organizationId = await this.getAdminOrganizationIdForWrite(userId);
    const secret = dto.secret?.trim() || randomBytes(32).toString('hex');

    return this.prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url: dto.url.trim(),
        secret,
        events: [...new Set(dto.events.map((e) => e.trim()))].filter(Boolean),
        createdBy: userId,
      },
    });
  }

  async listEndpoints(userKey: string) {
    const userId = await this.resolveUserId(userKey);
    const organizationId = await this.getAdminOrganizationIdForWrite(userId);

    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        createdBy: true,
      },
    });

    return rows;
  }

  async deactivateEndpoint(userKey: string, id: string) {
    const userId = await this.resolveUserId(userKey);
    const organizationId = await this.getAdminOrganizationIdForWrite(userId);

    const updated = await this.prisma.webhookEndpoint.updateMany({
      where: { id, organizationId },
      data: { isActive: false },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Webhook não encontrado.');
    }

    return { ok: true as const };
  }

  async sendTest(userKey: string, endpointId: string) {
    const userId = await this.resolveUserId(userKey);
    const organizationId = await this.getAdminOrganizationIdForWrite(userId);

    const ep = await this.prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, organizationId, isActive: true },
    });

    if (!ep) {
      throw new NotFoundException('Webhook não encontrado.');
    }

    const payload = {
      test: true,
      sentAt: new Date().toISOString(),
    };

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: ep.id,
        event: 'ping',
        payload,
      },
    });

    await this.deliveryQueue.add(
      { deliveryId: delivery.id },
      { removeOnComplete: true, removeOnFail: 100 },
    );

    return { deliveryId: delivery.id, event: 'ping' as const };
  }
}
