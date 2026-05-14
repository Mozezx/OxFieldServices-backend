import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ToconlineFiscalService } from './toconline-fiscal.service';
import { ToconlineAuthService } from './toconline-auth.service';

@Injectable()
export class ToconlineListener {
  private readonly logger = new Logger(ToconlineListener.name);

  constructor(
    private readonly fiscal: ToconlineFiscalService,
    private readonly auth: ToconlineAuthService,
  ) {}

  @OnEvent('invoice.sent')
  async onInvoiceSent(payload: { invoiceId: string }) {
    if (!this.auth.isEnabled()) return;
    try {
      await this.fiscal.orchestrateFiscalFlow(payload.invoiceId, 'sent');
    } catch (e) {
      this.logger.error(`invoice.sent → TOConline: ${String(e)}`);
    }
  }

  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: { invoiceId: string }) {
    if (!this.auth.isEnabled()) return;
    try {
      await this.fiscal.orchestrateFiscalFlow(payload.invoiceId, 'paid');
    } catch (e) {
      this.logger.error(`invoice.paid → TOConline: ${String(e)}`);
    }
  }
}
