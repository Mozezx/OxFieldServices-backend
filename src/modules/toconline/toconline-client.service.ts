import { Injectable, Logger } from '@nestjs/common';
import type { Invoice } from '@prisma/client';
import { ToconlineConfig } from './toconline.config';
import { ToconlineAuthService } from './toconline-auth.service';
import {
  toconlineFetchJson,
  unwrapDataArray,
} from './toconline-http';
import type { ToconlineJson } from './types/toconline.types';

@Injectable()
export class ToconlineClientService {
  private readonly logger = new Logger(ToconlineClientService.name);

  constructor(private readonly cfg: ToconlineConfig, private readonly auth: ToconlineAuthService) {}

  private httpCtx(): import('./toconline-http').ToconlineHttpContext {
    return {
      baseUrl: this.cfg.apiBaseUrl,
      getToken: () => this.auth.getAccessToken(),
    };
  }

  private encodeFilterParam(key: string, value: string): string {
    return `${encodeURIComponent(`filter[${key}]`)}=${encodeURIComponent(value)}`;
  }

  /** GET /api/customers — tenta localizar por NIF ou e-mail. */
  async findExistingCustomerId(invoice: Invoice): Promise<string | null> {
    const nif = invoice.clientNif?.trim();
    if (nif) {
      const q = this.encodeFilterParam('tax_registration_number', nif);
      const root = await toconlineFetchJson(this.httpCtx(), 'GET', `/api/customers?${q}`);
      const rows = unwrapDataArray(root);
      const id = rows[0]?.id;
      if (typeof id === 'string') return id;
    }
    const email = invoice.clientEmail?.trim();
    if (email) {
      const q = this.encodeFilterParam('email', email);
      const root = await toconlineFetchJson(this.httpCtx(), 'GET', `/api/customers?${q}`);
      const rows = unwrapDataArray(root);
      const id = rows[0]?.id;
      if (typeof id === 'string') return id;
    }
    return null;
  }

  /** POST /api/customers (JSON:API). */
  async createCustomer(invoice: Invoice): Promise<string> {
    const phoneRaw = invoice.clientPhone?.replace(/\D/g, '') ?? '';
    const phoneNum =
      phoneRaw.length > 0 ? Number.parseInt(phoneRaw.slice(0, 15), 10) : undefined;

    const payload = {
      data: {
        type: 'customers',
        attributes: {
          business_name: invoice.clientName,
          email: invoice.clientEmail,
          ...(invoice.clientNif?.trim()
            ? { tax_registration_number: invoice.clientNif.trim() }
            : {}),
          ...(Number.isFinite(phoneNum) ? { phone_number: phoneNum } : {}),
        },
      },
    };

    const root = (await toconlineFetchJson(
      this.httpCtx(),
      'POST',
      '/api/customers',
      payload,
    )) as ToconlineJson;
    const rows = unwrapDataArray(root);
    const id = rows[0]?.id;
    if (typeof id === 'string') return id;
    this.logger.error(`createCustomer: resposta sem id — ${JSON.stringify(root).slice(0, 400)}`);
    throw new Error('TOConline: criação de cliente sem id na resposta');
  }

  /**
   * Garante um customer_id TOConline para a invoice (cache em toconlineClientId).
   */
  async syncClient(invoice: Invoice): Promise<string> {
    if (invoice.toconlineClientId) return invoice.toconlineClientId;

    const existing = await this.findExistingCustomerId(invoice);
    if (existing) return existing;

    return this.createCustomer(invoice);
  }
}
