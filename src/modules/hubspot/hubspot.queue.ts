import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { HUBSPOT_SYNC_QUEUE } from './hubspot.constants';

export type HubspotJobName =
  | 'sync-company'
  | 'sync-contact'
  | 'sync-deal'
  | 'timeline-activity';

@Injectable()
export class HubspotQueue {
  constructor(@InjectQueue(HUBSPOT_SYNC_QUEUE) private readonly queue: Queue) {}

  add(name: HubspotJobName, data: Record<string, unknown>) {
    return this.queue.add(name, data, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }
}
