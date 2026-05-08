import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { InvoiceService } from './invoice.service';

/** Campos usados do PaymentIntent em payment_intent.succeeded (Stripe SDK v22 não exporta PaymentIntent no root). */
type PaymentIntentSucceededPayload = {
  id: string;
  metadata?: { contractId?: string; invoiceId?: string } | null;
  latest_charge?: string | { id: string } | null;
};

/** checkout.session.completed (Payment Link / Checkout). */
type CheckoutSessionPayload = {
  mode: string;
  payment_status: string;
  payment_link?: string | { id: string } | null;
  payment_intent?: string | { id: string } | null;
};

@ApiExcludeController()
@Controller('webhooks')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private stripeService: StripeService,
    private paymentsService: PaymentsService,
    private invoiceService: InvoiceService,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    if (!req.rawBody) throw new BadRequestException('Raw body não disponível');

    let event;
    try {
      event = this.stripeService.constructWebhookEvent(req.rawBody, sig);
    } catch {
      throw new BadRequestException('Stripe webhook signature inválida');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as CheckoutSessionPayload;
        if (session.mode !== 'payment' || session.payment_status !== 'paid') {
          break;
        }
        const paymentLinkRef = session.payment_link;
        const paymentLinkId =
          typeof paymentLinkRef === 'string'
            ? paymentLinkRef
            : paymentLinkRef?.id;
        if (!paymentLinkId) {
          break;
        }
        const link = await this.stripeService.client.paymentLinks.retrieve(
          paymentLinkId,
        );
        const invoiceId = link.metadata?.invoiceId?.trim();
        const piId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;
        if (invoiceId && piId) {
          await this.invoiceService.markAsPaid(invoiceId, piId);
        }
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object as PaymentIntentSucceededPayload;
        const invoiceId = pi.metadata?.invoiceId?.trim();
        if (invoiceId) {
          await this.invoiceService.markAsPaid(invoiceId, pi.id);
          break;
        }
        const chargeId =
          typeof pi.latest_charge === 'string'
            ? pi.latest_charge
            : pi.latest_charge?.id;
        const contractId = await this.paymentsService.resolveContractIdForPaymentIntent(
          pi.id,
          pi.metadata?.contractId,
        );
        if (contractId) {
          await this.paymentsService.activateEscrow(contractId, chargeId);
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as {
          metadata?: { contractId?: string; invoiceId?: string };
          last_payment_error?: { message?: string };
        };
        if (pi.metadata?.invoiceId) {
          this.logger.warn(
            `Pagamento falhou (invoice ${pi.metadata.invoiceId}): ${pi.last_payment_error?.message ?? 'sem detalhe'}`,
          );
        }
        this.paymentsService.handlePaymentIntentFailed(
          pi.metadata?.contractId,
          pi.last_payment_error?.message,
        );
        break;
      }
      // transfer.created é registrado em releaseSplitPayment — sem ação extra necessária
    }

    return { received: true };
  }
}
