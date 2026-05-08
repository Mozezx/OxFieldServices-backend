import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendInvoiceChargeEmailParams = {
  to: string;
  clientName: string;
  contractorName: string;
  projectTitle: string;
  invoiceNumber: string;
  totalAmountLabel: string;
  payUrl: string;
  dueDateLabel: string | null;
  notes: string | null;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Envia e-mail de cobrança ao cliente final (Resend).
   * Sem `RESEND_API_KEY`, regista aviso e não falha.
   */
  async sendInvoiceChargeEmail(params: SendInvoiceChargeEmailParams): Promise<{
    sent: boolean;
    skippedReason?: string;
  }> {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const from =
      this.config.get<string>('RESEND_FROM_EMAIL')?.trim() ??
      'OX Cobranças <onboarding@resend.dev>';

    if (!apiKey) {
      this.logger.warn(
        'RESEND_API_KEY não definido — e-mail de cobrança não enviado (invoice continua enviada).',
      );
      return { sent: false, skippedReason: 'missing_resend_api_key' };
    }

    const subject = `${params.projectTitle} — Cobrança #${params.invoiceNumber}`;

    const notesBlock =
      params.notes && params.notes.trim().length > 0
        ? `<p style="margin:16px 0 0;color:#444"><strong>Notas:</strong><br/>${this.escapeHtml(params.notes.trim()).replace(/\n/g, '<br/>')}</p>`
        : '';

    const dueBlock = params.dueDateLabel
      ? `<p style="margin:16px 0 0;color:#444"><strong>Vencimento:</strong> ${this.escapeHtml(params.dueDateLabel)}</p>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111;max-width:32rem;margin:0 auto;padding:24px">
  <p>Olá ${this.escapeHtml(params.clientName)},</p>
  <p><strong>${this.escapeHtml(params.contractorName)}</strong> enviou uma cobrança no valor de <strong>${this.escapeHtml(params.totalAmountLabel)}</strong> (projeto: ${this.escapeHtml(params.projectTitle)}).</p>
  <p style="margin:24px 0">
    <a href="${params.payUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Pagar agora</a>
  </p>
  ${dueBlock}
  ${notesBlock}
  <p style="margin-top:32px;font-size:12px;color:#888">Mensagem automática — OX Field Services</p>
</body>
</html>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(
        `Resend falhou (${res.status}): ${errText.slice(0, 500)}`,
      );
      return { sent: false, skippedReason: `resend_http_${res.status}` };
    }

    this.logger.log(`E-mail de cobrança enviado para ${params.to} (${params.invoiceNumber})`);
    return { sent: true };
  }
}
