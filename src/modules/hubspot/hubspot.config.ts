import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HubspotConfig {
  readonly token: string;
  readonly portalId: string;
  readonly appId: string;
  readonly projectsPipelineId: string;
  readonly webhookSecret: string;

  // Mapeamento status Ox → stage ID do pipeline "default" do HubSpot
  readonly stageMap: Record<string, string> = {
    draft:            'appointmentscheduled',
    matched:          'qualifiedtobuy',
    contract_signed:  'presentationscheduled',
    active_escrow:    'decisionmakerboughtin',
    in_execution:     'contractsent',
    closing:          'contractsent',
    closed:           'closedwon',
    rejected:         'closedlost',
  };

  constructor(config: ConfigService) {
    this.token = config.getOrThrow('HUBSPOT_PRIVATE_APP_TOKEN');
    this.portalId = config.getOrThrow('HUBSPOT_PORTAL_ID');
    this.appId = config.get('HUBSPOT_APP_ID', '');
    this.projectsPipelineId = config.get('HUBSPOT_PROJECTS_PIPELINE_ID', '');
    this.webhookSecret = config.get('HUBSPOT_WEBHOOK_SECRET', '');
  }
}
