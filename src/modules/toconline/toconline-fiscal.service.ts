import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Invoice, InvoiceItem } from '@prisma/client';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { ToconlineClientService } from './toconline-client.service';
import { ToconlineConfig } from './toconline.config';
import { ToconlineSalesDocumentService } from './toconline-sales-document.service';
import { ToconlineHttpError } from './toconline-http';
import { ToconlineAuthService } from './toconline-auth.service';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class ToconlineFiscalService {
  private readonly logger = new Logger(ToconlineFiscalService.name);
  private supabase: SupabaseClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ToconlineConfig,
    private readonly clients: ToconlineClientService,
    private readonly sales: ToconlineSalesDocumentService,
    private readonly email: EmailService,
    private readonly nestConfig: ConfigService,
    private readonly cache: CacheService,
    private readonly auth: ToconlineAuthService,
  ) {}

  private getSupabase(): SupabaseClient {
    if (this.supabase) return this.supabase;
    const url = this.nestConfig.get<string>('SUPABASE_URL');
    const key =
      this.nestConfig.get<string>('SUPABASE_SERVICE_KEY') ??
      this.nestConfig.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY em falta para PDF fiscal');
    }
    this.supabase = createClient(url, key);
    return this.supabase;
  }

  private async invalidateInvoiceCaches(): Promise<void> {
    await this.cache.invalidateByPrefix('invoices:list:');
  }

  /**
   * Re-envia comunicação AT + tenta PDF (admin).
   */
  async retryCommunicateToAT(invoiceId: string): Promise<{ ok: boolean; message: string }> {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv?.toconlineDocId) {
      return { ok: false, message: 'Invoice sem toconlineDocId' };
    }
    try {
      await this.sales.sendDocumentAtWebservice(inv.toconlineDocId);
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          toconlineStatus: 'sent_at',
          toconlineSentAt: new Date(),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { toconlineStatus: 'error' },
      });
      this.logStructuredError(invoiceId, 'communicate_at_retry', e);
      await this.invalidateInvoiceCaches();
      return { ok: false, message: msg };
    }

    try {
      const pdfUrl = await this.downloadAndStorePdf(inv.toconlineDocId, invoiceId);
      if (pdfUrl) {
        await this.prisma.invoice.update({
          where: { id: invoiceId },
          data: { toconlinePdfUrl: pdfUrl },
        });
      }
    } catch (e) {
      this.logStructuredError(invoiceId, 'communicate_at_pdf', e);
    }

    await this.invalidateInvoiceCaches();
    return { ok: true, message: 'Comunicação AT concluída' };
  }

  async pullFiscalPdfFromToconline(
    invoiceId: string,
  ): Promise<{ ok: boolean; message: string; pdfUrl?: string }> {
    if (!this.auth.isEnabled()) {
      return { ok: false, message: 'TOConline não está configurado' };
    }

    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv?.toconlineDocId) {
      return { ok: false, message: 'Invoice sem documento TOConline criado' };
    }

    try {
      const pdfUrl = await this.downloadAndStorePdf(inv.toconlineDocId, invoiceId);
      if (!pdfUrl) return { ok: false, message: 'TOConline não devolveu PDF' };

      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { toconlinePdfUrl: pdfUrl },
      });
      await this.invalidateInvoiceCaches();

      return { ok: true, message: 'PDF fiscal atualizado', pdfUrl };
    } catch (e) {
      this.logStructuredError(invoiceId, 'pull_pdf', e);
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: msg };
    }
  }

  async orchestrateFiscalFlow(
    invoiceId: string,
    trigger: 'sent' | 'paid',
  ): Promise<void> {
    if (!this.auth.isEnabled()) {
      this.logger.debug(`TOConline desligado — invoice ${invoiceId}`);
      return;
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        project: {
          select: {
            title: true,
            organization: { select: { name: true } },
          },
        },
      },
    });
    if (!invoice) {
      this.logger.warn(`orchestrateFiscalFlow: invoice ${invoiceId} não encontrada`);
      return;
    }
    if (invoice.toconlineDocId) {
      this.logger.log(`TOConline: invoice ${invoice.number} já tem documento — a ignorar`);
      return;
    }
    if (invoice.status === 'cancelled' || invoice.status === 'draft') {
      return;
    }

    const docType =
      trigger === 'paid'
        ? this.cfg.defaultDocumentTypePaid
        : this.cfg.defaultDocumentTypeSent;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.runOnce(invoice, docType);
        await this.invalidateInvoiceCaches();
        return;
      } catch (e) {
        lastErr = e;
        this.logStructuredError(invoiceId, `attempt_${attempt}`, e);
        if (attempt < 3) await sleep(1000 * 2 ** (attempt - 1));
      }
    }
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { toconlineStatus: 'error' },
    });
    await this.invalidateInvoiceCaches();
    this.logger.error(
      `TOConline: falha definitiva invoice ${invoiceId}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  private logStructuredError(invoiceId: string, code: string, err: unknown): void {
    const raw =
      err instanceof ToconlineHttpError ? err.bodySnippet : JSON.stringify(err);
    this.logger.error(
      JSON.stringify({
        invoiceId,
        errorCode: code,
        message: err instanceof Error ? err.message : String(err),
        rawResponse: typeof raw === 'string' ? raw.slice(0, 1200) : raw,
      }),
    );
  }

  private async runOnce(
    invoice: Invoice & {
      items: InvoiceItem[];
      project: { title: string; organization: { name: string | null } | null };
    },
    docType: string,
  ): Promise<void> {
    const customerId = await this.clients.syncClient(invoice);
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { toconlineClientId: customerId, toconlineStatus: 'pending' },
    });

    const { docId, docNumber } = await this.sales.createSalesDocument(invoice, docType);

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        toconlineDocId: docId,
        toconlineDocNumber: docNumber,
      },
    });

    if (this.cfg.hasAtCredentials()) {
      try {
        await this.sales.sendDocumentAtWebservice(docId);
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            toconlineStatus: 'sent_at',
            toconlineSentAt: new Date(),
          },
        });
      } catch (e) {
        this.logStructuredError(invoice.id, 'send_at', e);
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { toconlineStatus: 'error' },
        });
      }
    } else {
      this.logger.warn(
        `TOConline: credenciais AT em falta — documento ${docId} criado mas não comunicado`,
      );
    }

    let pdfUrl: string | null = null;
    for (let p = 1; p <= 3; p++) {
      try {
        pdfUrl = await this.downloadAndStorePdf(docId, invoice.id);
        break;
      } catch (e) {
        this.logStructuredError(invoice.id, `pdf_try_${p}`, e);
        if (p < 3) await sleep(30_000);
      }
    }

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        ...(pdfUrl ? { toconlinePdfUrl: pdfUrl } : {}),
      },
    });

    if (pdfUrl) {
      await this.email.sendFiscalInvoiceEmail({
        to: invoice.clientEmail,
        clientName: invoice.clientName,
        internalNumber: invoice.number,
        fiscalNumber: docNumber,
        pdfUrl,
        contractorName: invoice.project.organization?.name ?? 'OX',
        projectTitle: invoice.project.title,
      });
    }
  }

  private async downloadAndStorePdf(
    toconlineDocId: string,
    invoiceId: string,
  ): Promise<string | null> {
    const printUrl = await this.sales.resolvePdfDownloadUrl(toconlineDocId);
    const res = await fetch(printUrl);
    if (!res.ok) {
      throw new Error(`Download PDF TOConline falhou: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const path = `${invoiceId}/${Date.now()}-fiscal.pdf`;
    const bucket = this.cfg.fiscalBucket;
    const sb = this.getSupabase();
    const { error } = await sb.storage.from(bucket).upload(path, buf, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: 'public, max-age=31536000',
    });
    if (error) {
      throw new Error(`Supabase upload fiscal: ${error.message}`);
    }
    const {
      data: { publicUrl },
    } = sb.storage.from(bucket).getPublicUrl(path);
    return publicUrl;
  }
}
