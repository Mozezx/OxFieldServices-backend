import {
  InjectQueue,
  OnQueueCompleted,
  OnQueueFailed,
  Process,
  Processor,
} from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bull';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';
import type { WebhookDeliveryJob } from './webhooks.service';

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;

@Processor(WEBHOOK_DELIVERY_QUEUE)
@Injectable()
export class WebhookDeliveryProcessor {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly deliveryQueue: Queue<WebhookDeliveryJob>,
  ) {}

  @Process({ concurrency: 5 })
  async handle(job: Job<WebhookDeliveryJob>) {
    const { deliveryId } = job.data;

    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });

    if (!delivery) {
      this.logger.warn(`Delivery ${deliveryId} não encontrada`);
      return;
    }

    if (!delivery.endpoint.isActive) {
      return;
    }

    if (delivery.deliveredAt) {
      return;
    }

    if (delivery.attemptCount >= MAX_ATTEMPTS) {
      return;
    }

    const bodyObj = { event: delivery.event, payload: delivery.payload };
    const body = JSON.stringify(bodyObj);
    const signature = createHmac('sha256', delivery.endpoint.secret)
      .update(body)
      .digest('hex');

    try {
      const res = await fetch(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const statusCode = res.status;

      if (statusCode >= 200 && statusCode < 300) {
        await this.prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            statusCode,
            deliveredAt: new Date(),
            nextRetryAt: null,
          },
        });
        return;
      }

      await this.failAndMaybeRetry(deliveryId, delivery.attemptCount, statusCode);
    } catch (err) {
      this.logger.warn(
        `Webhook delivery ${deliveryId} falhou: ${(err as Error).message}`,
      );
      await this.failAndMaybeRetry(deliveryId, delivery.attemptCount, null);
    }
  }

  private async failAndMaybeRetry(
    deliveryId: string,
    currentAttempts: number,
    statusCode: number | null,
  ) {
    const attemptCount = currentAttempts + 1;

    const delayMs = Math.pow(2, attemptCount) * 30 * 1000;

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attemptCount,
        ...(statusCode != null ? { statusCode } : {}),
        nextRetryAt:
          attemptCount < MAX_ATTEMPTS ? new Date(Date.now() + delayMs) : null,
      },
    });

    if (attemptCount < MAX_ATTEMPTS) {
      await this.deliveryQueue.add(
        { deliveryId },
        {
          delay: delayMs,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(`Webhook job ${job.id} concluído`);
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`Webhook job ${job.id} erro Bull: ${err.message}`);
  }
}
