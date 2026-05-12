import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@hubspot/api-client';
import { PrismaService } from '../../prisma/prisma.service';
import { HubspotConfig } from './hubspot.config';
import { HubspotMapper } from './hubspot.mapper';
import { Organization, User, Project } from '@prisma/client';

@Injectable()
export class HubspotService {
  private readonly client: Client;
  private readonly logger = new Logger(HubspotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: HubspotConfig,
    private readonly mapper: HubspotMapper,
  ) {
    this.client = new Client({ accessToken: this.config.token });
  }

  async upsertCompany(org: Organization): Promise<void> {
    try {
      const props = this.mapper.toCompany(org) as unknown as Record<string, string>;

      let hubspotId = org.hubspotCompanyId;
      if (hubspotId) {
        await this.client.crm.companies.basicApi.update(hubspotId, { properties: props });
      } else {
        const res = await this.client.crm.companies.basicApi.create({ properties: props });
        hubspotId = res.id;
        await this.prisma.organization.update({
          where: { id: org.id },
          data: { hubspotCompanyId: hubspotId },
        });
      }
      await this.logSync('organization', org.id, 'upsert', 'success');
    } catch (err) {
      await this.logSync('organization', org.id, 'upsert', 'error', String(err));
      this.logger.error(`upsertCompany failed for org ${org.id}`, err);
    }
  }

  async upsertContact(user: User, hubspotCompanyId?: string): Promise<void> {
    try {
      const props = this.mapper.toContact(user) as unknown as Record<string, string>;

      let hubspotId = user.hubspotContactId;
      if (hubspotId) {
        await this.client.crm.contacts.basicApi.update(hubspotId, { properties: props });
      } else {
        const res = await this.client.crm.contacts.basicApi.create({ properties: props });
        hubspotId = res.id;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { hubspotContactId: hubspotId },
        });

        if (hubspotCompanyId) {
          await this.client.crm.associations.v4.basicApi.create(
            'contacts',
            hubspotId,
            'companies',
            hubspotCompanyId,
            [{ associationCategory: 'HUBSPOT_DEFINED' as any, associationTypeId: 1 }],
          );
        }
      }
      await this.logSync('user', user.id, 'upsert', 'success');
    } catch (err) {
      await this.logSync('user', user.id, 'upsert', 'error', String(err));
      this.logger.error(`upsertContact failed for user ${user.id}`, err);
    }
  }

  async upsertDeal(project: Project): Promise<void> {
    try {
      const props = this.mapper.toDeal(project) as unknown as Record<string, string>;

      let hubspotId = project.hubspotDealId;
      if (hubspotId) {
        await this.client.crm.deals.basicApi.update(hubspotId, { properties: props });
      } else {
        const res = await this.client.crm.deals.basicApi.create({ properties: props });
        hubspotId = res.id;
        await this.prisma.project.update({
          where: { id: project.id },
          data: { hubspotDealId: hubspotId },
        });
      }
      await this.logSync('project', project.id, 'upsert', 'success');
    } catch (err) {
      await this.logSync('project', project.id, 'upsert', 'error', String(err));
      this.logger.error(`upsertDeal failed for project ${project.id}`, err);
    }
  }

  async createActivityNote(projectId: string, body: string): Promise<void> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { hubspotDealId: true },
      });
      if (!project?.hubspotDealId) {
        this.logger.warn(`createActivityNote: project ${projectId} sem hubspotDealId — ignorado`);
        return;
      }
      const dealId = project.hubspotDealId;

      const note = await this.client.crm.objects.notes.basicApi.create({
        properties: {
          hs_note_body: body,
          hs_timestamp: String(Date.now()),
        },
        associations: [
          {
            to: { id: dealId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED' as any, associationTypeId: 214 }],
          },
        ],
      });
      await this.logSync('project', projectId, 'timeline_event', 'success');
      this.logger.log(`Note criada id=${note.id} → deal ${dealId}`);
    } catch (err) {
      await this.logSync('project', projectId, 'timeline_event', 'error', String(err));
      this.logger.error(`createActivityNote failed for project ${projectId}`, err);
    }
  }

  async handleDealPropertyChange(
    dealHubspotId: string,
    propertyName: string,
    propertyValue: string,
  ): Promise<void> {
    try {
      const project = await this.prisma.project.findFirst({
        where: { hubspotDealId: dealHubspotId },
      });
      if (!project) {
        this.logger.warn(`deal.propertyChange: projeto não encontrado para dealId=${dealHubspotId}`);
        return;
      }
      await this.createActivityNote(
        project.id,
        `HubSpot: propriedade "${propertyName}" atualizada para "${propertyValue}".`,
      );
    } catch (err) {
      this.logger.error(`handleDealPropertyChange falhou para deal ${dealHubspotId}`, err);
    }
  }

  async handleContactCreation(contactHubspotId: string): Promise<void> {
    try {
      const res = await this.client.crm.contacts.basicApi.getById(
        contactHubspotId,
        ['email', 'firstname', 'lastname'],
      );
      const email = res.properties['email'];
      if (!email) return;

      const existing = await this.prisma.user.findFirst({ where: { email } });
      if (existing) {
        this.logger.log(`contact.creation: usuário já existe email=${email}`);
        return;
      }

      this.logger.log(
        `contact.creation: nenhum usuário local para email=${email} (hubspot id=${contactHubspotId})`,
      );
      await this.logSync('contact', contactHubspotId, 'webhook_contact_creation', 'no_local_user');
    } catch (err) {
      this.logger.error(`handleContactCreation falhou para contact ${contactHubspotId}`, err);
      await this.logSync('contact', contactHubspotId, 'webhook_contact_creation', 'error', String(err));
    }
  }

  async subscribeWebhooks(callbackUrl: string): Promise<{ subscribed: string[] }> {
    if (!this.config.appId) {
      throw new Error('HUBSPOT_APP_ID não configurado — defina-o no .env e reinicie.');
    }
    const appId = Number(this.config.appId);
    const toCreate = [
      { eventType: 'deal.propertyChange' as const, propertyName: 'dealstage' },
      { eventType: 'contact.creation' as const },
    ];
    const subscribed: string[] = [];

    const existing = await this.client.webhooks.subscriptionsApi.getAll(appId);
    const existingTypes = new Set(
      (existing.results ?? []).map((s) => `${s.eventType}:${(s as any).propertyName ?? ''}`),
    );

    for (const sub of toCreate) {
      const key = `${sub.eventType}:${(sub as any).propertyName ?? ''}`;
      if (existingTypes.has(key)) {
        this.logger.log(`Subscription já existe: ${key}`);
        continue;
      }
      await this.client.webhooks.subscriptionsApi.create(appId, {
        active: true,
        eventType: sub.eventType,
        ...(('propertyName' in sub) ? { propertyName: sub.propertyName } : {}),
      } as any);
      subscribed.push(sub.eventType);
      this.logger.log(`Subscription criada: ${sub.eventType}`);
    }

    this.logger.log(`subscribeWebhooks concluído. callbackUrl=${callbackUrl}`);
    return { subscribed };
  }

  private async logSync(
    entityType: string,
    entityId: string,
    action: string,
    status: string,
    error?: string,
  ) {
    await this.prisma.hubspotSyncLog.create({
      data: { entityType, entityId, action, status, error },
    });
  }
}
