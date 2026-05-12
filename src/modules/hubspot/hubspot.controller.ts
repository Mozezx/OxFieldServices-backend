import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { HubspotConfig } from './hubspot.config';
import { HubspotQueue } from './hubspot.queue';
import { HubspotService } from './hubspot.service';

interface HubspotWebhookEvent {
  eventType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
}

@ApiTags('HubSpot')
@Controller('hubspot')
export class HubspotController {
  private readonly logger = new Logger(HubspotController.name);

  constructor(
    private readonly config: HubspotConfig,
    private readonly queue: HubspotQueue,
    private readonly service: HubspotService,
  ) {}

  // ── Admin: re-sync manual ──────────────────────────────────────────────────

  @Post('admin/sync-org/:orgId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Força re-sync de uma Organization → HubSpot Company (admin)' })
  syncOrg(@Param('orgId') orgId: string) {
    return this.queue.add('sync-company', { organizationId: orgId });
  }

  @Post('admin/sync-user/:userId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Força re-sync de um User → HubSpot Contact (admin)' })
  syncUser(@Param('userId') userId: string) {
    return this.queue.add('sync-contact', { userId });
  }

  @Post('admin/sync-deal/:projectId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Força re-sync de um Project → HubSpot Deal (admin)' })
  syncDeal(@Param('projectId') projectId: string) {
    return this.queue.add('sync-deal', { projectId });
  }

  // ── Admin: registrar subscriptions de webhook no HubSpot ──────────────────

  @Post('admin/subscribe-webhooks')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Registra subscriptions de webhook no HubSpot (requer HUBSPOT_APP_ID)' })
  subscribeWebhooks(@Body() body: { callbackUrl: string }) {
    return this.service.subscribeWebhooks(body.callbackUrl);
  }

  // ── Webhook público (HubSpot → App) ───────────────────────────────────────

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request,
    @Headers('x-hubspot-signature-v3') signature: string,
    @Headers('x-hubspot-request-timestamp') timestamp: string,
  ) {
    this.verifySignatureV3(req, signature, timestamp);

    const events: HubspotWebhookEvent[] = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      await this.routeEvent(event).catch((err) =>
        this.logger.error(`Erro roteando evento ${event.eventType}: ${String(err)}`),
      );
    }

    return { received: true };
  }

  // ── Roteamento de eventos ──────────────────────────────────────────────────

  private async routeEvent(event: HubspotWebhookEvent) {
    switch (event.eventType) {
      case 'deal.propertyChange':
        await this.service.handleDealPropertyChange(
          String(event.objectId),
          event.propertyName ?? '',
          event.propertyValue ?? '',
        );
        break;

      case 'contact.creation':
        await this.service.handleContactCreation(String(event.objectId));
        break;

      default:
        this.logger.log(`Evento HubSpot não tratado: ${event.eventType}`);
    }
  }

  // ── Validação de assinatura v3 (HMAC-SHA256 com anti-replay) ──────────────

  private verifySignatureV3(req: Request, signature: string, timestamp: string) {
    if (!this.config.webhookSecret) return;

    // Rejeita requisições com mais de 5 minutos (anti-replay)
    const tsMs = Number(timestamp);
    if (!tsMs || Date.now() - tsMs > 5 * 60 * 1000) {
      throw new UnauthorizedException('HubSpot webhook timestamp expirado ou ausente');
    }

    // Usa rawBody (disponível porque NestFactory.create({ rawBody: true }))
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const bodyStr = rawBody ? rawBody.toString('utf8') : JSON.stringify(req.body);

    const method = req.method.toUpperCase();
    const uri = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const payload = `${method}${uri}${bodyStr}${timestamp}`;

    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('base64');

    try {
      const sigBuf = Buffer.from(signature ?? '', 'base64');
      const expBuf = Buffer.from(expected, 'base64');
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw new UnauthorizedException('Assinatura HubSpot inválida');
      }
    } catch {
      throw new UnauthorizedException('Assinatura HubSpot inválida');
    }
  }
}
