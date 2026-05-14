import { Injectable, Logger } from '@nestjs/common';
import type { Invoice, InvoiceItem } from '@prisma/client';
import { ToconlineConfig } from './toconline.config';
import { ToconlineAuthService } from './toconline-auth.service';
import { toconlineFetchJson, unwrapAttributes, unwrapDataArray } from './toconline-http';
import type { ToconlineJson, ToconlineSalesDocumentLine } from './types/toconline.types';

export type CreateSalesDocumentResult = {
  docId: string;
  docNumber: string | null;
};

@Injectable()
export class ToconlineSalesDocumentService {
  private readonly logger = new Logger(ToconlineSalesDocumentService.name);

  constructor(
    private readonly cfg: ToconlineConfig,
    private readonly auth: ToconlineAuthService,
  ) {}

  private httpCtx(): import('./toconline-http').ToconlineHttpContext {
    return {
      baseUrl: this.cfg.apiBaseUrl,
      getToken: () => this.auth.getAccessToken(),
    };
  }

  private linesFromItems(
    items: InvoiceItem[],
    taxCode: string,
  ): ToconlineSalesDocumentLine[] {
    return items.map((row) => ({
      item_type: 'Service' as const,
      description: row.description,
      quantity: Number(row.quantity),
      unit_price: Number(row.unitPrice),
      tax_code: taxCode,
      tax_country_region: 'PT',
    }));
  }

  /**
   * POST /api/v1/commercial_sales_documents — documento finalizado.
   */
  async createSalesDocument(
    invoice: Invoice & { items: InvoiceItem[] },
    documentType: string,
  ): Promise<CreateSalesDocumentResult> {
    const taxCode = this.cfg.defaultTaxCode;
    const lines = this.linesFromItems(invoice.items, taxCode);
    const nif = invoice.clientNif?.trim();

    const useFs =
      documentType === 'FT' && !nif && Number(invoice.totalAmount) < 1000;
    const effectiveType = useFs ? 'FS' : documentType;

    const body: Record<string, unknown> = {
      document_type: effectiveType,
      customer_business_name: invoice.clientName,
      currency_iso_code: 'EUR',
      vat_included_prices: false,
      lines,
      external_reference: invoice.number,
      ...(invoice.dueDate ? { due_date: invoice.dueDate.toISOString().slice(0, 10) } : {}),
      ...(nif ? { customer_tax_registration_number: nif } : {}),
      ...(invoice.clientAddress?.trim()
        ? { customer_address_detail: invoice.clientAddress.trim() }
        : {}),
    };

    const root = (await toconlineFetchJson(
      this.httpCtx(),
      'POST',
      '/api/v1/commercial_sales_documents',
      body,
    )) as ToconlineJson;

    const rootObj = root as ToconlineJson;
    let docId: string | null = typeof rootObj.id === 'string' ? rootObj.id : null;
    const single = rootObj.data;
    if (
      !docId &&
      single &&
      typeof single === 'object' &&
      !Array.isArray(single) &&
      typeof (single as ToconlineJson).id === 'string'
    ) {
      docId = (single as ToconlineJson).id as string;
    }
    if (!docId) {
      const arr = unwrapDataArray(root);
      if (typeof arr[0]?.id === 'string') docId = arr[0]!.id as string;
    }

    if (!docId) {
      this.logger.warn(
        `createSalesDocument: id ausente na resposta POST, a tentar GET — ${JSON.stringify(root).slice(0, 300)}`,
      );
    }

    let docNumber =
      this.readDocumentNo(root) ??
      (docId ? this.readDocumentNo(await this.fetchDocumentRaw(docId)) : null);

    if (!docId) {
      throw new Error('TOConline: documento criado sem id');
    }

    if (!docNumber) {
      const again = await this.fetchDocumentRaw(docId);
      docNumber = this.readDocumentNo(again);
    }

    return { docId, docNumber };
  }

  private readDocumentNo(root: ToconlineJson | unknown): string | null {
    if (!root || typeof root !== 'object') return null;
    const r = root as ToconlineJson;
    const direct =
      typeof r.document_no === 'string'
        ? r.document_no
        : typeof (r as ToconlineJson).document_number === 'string'
          ? ((r as ToconlineJson).document_number as string)
          : null;
    if (direct) return direct;
    const data = r.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const attrs = unwrapAttributes(data as ToconlineJson);
      const no =
        typeof attrs.document_no === 'string'
          ? attrs.document_no
          : typeof attrs.document_number === 'string'
            ? (attrs.document_number as string)
            : null;
      if (no) return no;
    }
    const arr = unwrapDataArray(r);
    if (arr[0]) {
      const attrs = unwrapAttributes(arr[0]!);
      return typeof attrs.document_no === 'string'
        ? attrs.document_no
        : typeof attrs.document_number === 'string'
          ? (attrs.document_number as string)
          : null;
    }
    return null;
  }

  private async fetchDocumentRaw(docId: string): Promise<ToconlineJson> {
    return (await toconlineFetchJson(
      this.httpCtx(),
      'GET',
      `/api/v1/commercial_sales_documents/${encodeURIComponent(docId)}`,
    )) as ToconlineJson;
  }

  /**
   * PATCH /api/send_document_at_webservice — credenciais portal AT.
   */
  async sendDocumentAtWebservice(docId: string): Promise<void> {
    if (!this.cfg.hasAtCredentials()) {
      throw new Error('TOCONLINE_AT_USERNAME / TOCONLINE_AT_PASSWORD_BASE64 em falta');
    }
    const payload = {
      data: {
        type: 'send_document_at_webservice',
        id: docId,
        attributes: {
          entity_username: this.cfg.atUsername,
          entity_password: this.cfg.atPasswordBase64,
        },
      },
    };
    await toconlineFetchJson(
      this.httpCtx(),
      'PATCH',
      '/api/send_document_at_webservice',
      payload,
    );
  }

  /**
   * GET /api/url_for_print/{id}?filter[type]=Document — devolve URL HTTPS do PDF.
   */
  async resolvePdfDownloadUrl(docId: string): Promise<string> {
    const root = (await toconlineFetchJson(
      this.httpCtx(),
      'GET',
      `/api/url_for_print/${encodeURIComponent(docId)}?filter[type]=Document`,
    )) as ToconlineJson;
    const arr = unwrapDataArray(root);
    const attrs = arr[0] ? unwrapAttributes(arr[0]!) : {};
    const url = attrs.url as ToconlineJson | undefined;
    if (url && typeof url === 'object') {
      const scheme = typeof url.scheme === 'string' ? url.scheme : 'https';
      const host = typeof url.host === 'string' ? url.host : '';
      const path = typeof url.path === 'string' ? url.path : '';
      if (host && path) return `${scheme}://${host}${path.startsWith('/') ? '' : '/'}${path}`;
    }
    throw new Error('TOConline: resposta url_for_print sem URL');
  }

  /** GET de diagnóstico (token válido). */
  async pingCompany(): Promise<unknown> {
    const paths = ['/api/v1/company', '/api/company', '/api/customers?page[size]=1'];
    let last: unknown = null;
    for (const p of paths) {
      try {
        last = await toconlineFetchJson(this.httpCtx(), 'GET', p);
        return { path: p, body: last };
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }
}
