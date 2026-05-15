import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Invoice,
  InvoiceFeeModel,
  InvoiceItem,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { StripeService } from './stripe.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { EmailService } from '../notifications/email.service';
import { ToconlineAuthService } from '../toconline/toconline-auth.service';

export type InvoiceStats = {
  counts: Record<InvoiceStatus, number>;
  paidThisMonthCount: number;
  paidThisMonthTotal: number;
  outstandingTotal: number;
  /** Cobranças enviadas / vencidas — aguardando pagamento do cliente final */
  awaitingPaymentTotal: number;
  /** Reservado para repasse Connect (Fase 2) */
  contractorTransferredTotal: number;
  weeklyData: { week: string; paid: number; pending: number }[];
};

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
    private readonly cache: CacheService,
    private readonly toconlineAuth: ToconlineAuthService,
  ) {}

  private async invalidateInvoiceAdminListCache(): Promise<void> {
    await this.cache.invalidateByPrefix('invoices:list:');
  }

  private getPublicTokenSecret(): string {
    const dedicated = process.env.INVOICE_PUBLIC_TOKEN_SECRET?.trim();
    if (dedicated) return dedicated;
    const jwt = process.env.JWT_SECRET?.trim();
    if (jwt) return jwt;
    throw new InternalServerErrorException(
      'Defina INVOICE_PUBLIC_TOKEN_SECRET (ou JWT_SECRET) para rotas públicas de invoice',
    );
  }

  /** HMAC-SHA256(invoiceId) em base64url — mesmo valor enquanto o secret não mudar. */
  signPublicToken(invoiceId: string): string {
    return createHmac('sha256', this.getPublicTokenSecret())
      .update(invoiceId)
      .digest('base64url');
  }

  verifyPublicToken(invoiceId: string, token: string | undefined): boolean {
    if (!token) return false;
    try {
      const expected = this.signPublicToken(invoiceId);
      const a = Buffer.from(token, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** Default `OX_PLATFORM_FEE_PERCENT` — fallback 2.5 */
  private getDefaultPlatformFeePercent(): number {
    const raw = process.env.OX_PLATFORM_FEE_PERCENT?.trim();
    if (!raw) return 2.5;
    const n = parseFloat(raw.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : 2.5;
  }

  /**
   * Default `OX_FEE_MODEL`: `pass-through` | `pass_through` → PASS_THROUGH; `absorbed` → ABSORBED.
   * Recomendação do plano: pass-through.
   */
  private getDefaultFeeModelFromEnv(): InvoiceFeeModel {
    const raw = process.env.OX_FEE_MODEL?.trim().toLowerCase() ?? '';
    if (raw === 'absorbed') return InvoiceFeeModel.ABSORBED;
    return InvoiceFeeModel.PASS_THROUGH;
  }

  private parseFeeModelInput(
    value: 'PASS_THROUGH' | 'ABSORBED' | undefined,
  ): InvoiceFeeModel {
    if (value === 'ABSORBED') return InvoiceFeeModel.ABSORBED;
    return InvoiceFeeModel.PASS_THROUGH;
  }

  /**
   * PASS_THROUGH: cliente paga subtotal + taxa (totalAmount = subtotal + fee).
   * ABSORBED: cliente paga só o subtotal; taxa deduzida ao contratante (totalAmount = subtotal).
   */
  calculateInvoiceTotals(
    subtotal: number,
    feePercent: number,
    feeModel: InvoiceFeeModel,
  ): { feeAmount: number; totalAmount: number } {
    const feeAmount =
      Math.round(((subtotal * feePercent) / 100 + Number.EPSILON) * 100) / 100;
    if (feeModel === InvoiceFeeModel.ABSORBED) {
      const totalAmount =
        Math.round((subtotal + Number.EPSILON) * 100) / 100;
      return { feeAmount, totalAmount };
    }
    const totalAmount =
      Math.round((subtotal + feeAmount + Number.EPSILON) * 100) / 100;
    return { feeAmount, totalAmount };
  }

  private assertToconlineFiscalReady(
    invoice: Invoice & { items: InvoiceItem[] },
  ): void {
    if (!this.toconlineAuth.isEnabled()) return;

    const missing: string[] = [];
    if (!invoice.clientName.trim()) missing.push('nome do cliente');
    if (!invoice.clientEmail.trim()) missing.push('e-mail do cliente');
    if (!invoice.clientNif?.trim()) missing.push('NIF do cliente');
    if (!invoice.clientAddress?.trim()) missing.push('morada fiscal do cliente');
    if (invoice.items.length === 0) missing.push('pelo menos uma linha da cobrança');

    const invalidLine = invoice.items.find(
      (item) =>
        !item.description.trim() ||
        Number(item.quantity) <= 0 ||
        Number(item.unitPrice) < 0,
    );
    if (invalidLine) {
      missing.push('descrição, quantidade e preço válidos em todas as linhas');
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Antes de enviar ao TOConline, preencha: ${missing.join(', ')}.`,
      );
    }
  }

  async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const latest = await this.prisma.invoice.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    let next = 1;
    if (latest?.number) {
      const suffix = latest.number.slice(prefix.length);
      const parsed = parseInt(suffix, 10);
      if (!Number.isNaN(parsed)) next = parsed + 1;
    }
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  async createInvoice(
    dto: CreateInvoiceDto,
  ): Promise<Invoice & { items: { id: string }[] }> {
    const projectId = dto.projectId;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    if (dto.phaseId) {
      const phase = await this.prisma.projectPhase.findFirst({
        where: { id: dto.phaseId, projectId },
      });
      if (!phase) {
        throw new BadRequestException('Fase não pertence a este projeto');
      }
    }

    const feePercent = dto.feePercent ?? this.getDefaultPlatformFeePercent();
    const feeModel =
      dto.feeModel != null
        ? this.parseFeeModelInput(dto.feeModel)
        : this.getDefaultFeeModelFromEnv();
    let subtotal = 0;
    const itemRows: {
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      total: Prisma.Decimal;
    }[] = [];

    for (const item of dto.items) {
      const lineTotal =
        Math.round(item.quantity * item.unitPrice * 100 + Number.EPSILON) / 100;
      subtotal =
        Math.round((subtotal + lineTotal + Number.EPSILON) * 100) / 100;
      itemRows.push({
        description: item.description,
        quantity: new Prisma.Decimal(item.quantity),
        unitPrice: new Prisma.Decimal(item.unitPrice),
        total: new Prisma.Decimal(lineTotal),
      });
    }

    const { feeAmount, totalAmount } = this.calculateInvoiceTotals(
      subtotal,
      feePercent,
      feeModel,
    );

    const number = await this.generateInvoiceNumber();

    const created = await this.prisma.invoice.create({
      data: {
        number,
        projectId,
        phaseId: dto.phaseId ?? null,
        clientName: dto.clientName,
        clientEmail: dto.clientEmail,
        clientPhone: dto.clientPhone ?? null,
        clientNif: dto.clientNif?.trim() || null,
        clientAddress: dto.clientAddress?.trim() || null,
        subtotal: new Prisma.Decimal(subtotal),
        feePercent: new Prisma.Decimal(feePercent),
        feeAmount: new Prisma.Decimal(feeAmount),
        totalAmount: new Prisma.Decimal(totalAmount),
        feeModel,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes ?? null,
        status: 'draft',
        items: { create: itemRows },
      },
      include: { items: { select: { id: true } } },
    });
    await this.invalidateInvoiceAdminListCache();
    return created;
  }

  async updateDraftInvoice(
    invoiceId: string,
    dto: UpdateInvoiceDto,
  ): Promise<Invoice & { items: { id: string }[] }> {
    const existing = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Invoice não encontrada');
    if (existing.status !== 'draft') {
      throw new BadRequestException('Só é possível editar invoices em rascunho');
    }

    const projectId = dto.projectId ?? existing.projectId;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const phaseId =
      dto.phaseId !== undefined ? dto.phaseId : existing.phaseId;
    if (phaseId) {
      const phase = await this.prisma.projectPhase.findFirst({
        where: { id: phaseId, projectId },
      });
      if (!phase) {
        throw new BadRequestException('Fase não pertence a este projeto');
      }
    }

    const feePercent =
      dto.feePercent ?? Number(existing.feePercent);
    const feeModel =
      dto.feeModel != null
        ? this.parseFeeModelInput(dto.feeModel)
        : existing.feeModel;

    let subtotal = 0;
    let itemRows: {
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      total: Prisma.Decimal;
    }[] = [];

    if (dto.items && dto.items.length > 0) {
      for (const item of dto.items) {
        const lineTotal =
          Math.round(item.quantity * item.unitPrice * 100 + Number.EPSILON) /
          100;
        subtotal =
          Math.round((subtotal + lineTotal + Number.EPSILON) * 100) / 100;
        itemRows.push({
          description: item.description,
          quantity: new Prisma.Decimal(item.quantity),
          unitPrice: new Prisma.Decimal(item.unitPrice),
          total: new Prisma.Decimal(lineTotal),
        });
      }
    } else {
      subtotal = Math.round(
        existing.items.reduce((s, row) => s + Number(row.total), 0) *
          100 +
          Number.EPSILON,
      ) / 100;
    }

    const { feeAmount, totalAmount } = this.calculateInvoiceTotals(
      subtotal,
      feePercent,
      feeModel,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items && dto.items.length > 0) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId } });
      }

      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          projectId,
          phaseId: phaseId ?? null,
          clientName: dto.clientName ?? existing.clientName,
          clientEmail: dto.clientEmail ?? existing.clientEmail,
          clientPhone:
            dto.clientPhone !== undefined
              ? dto.clientPhone
              : existing.clientPhone,
          clientNif:
            dto.clientNif !== undefined
              ? dto.clientNif?.trim() || null
              : existing.clientNif,
          clientAddress:
            dto.clientAddress !== undefined
              ? dto.clientAddress?.trim() || null
              : existing.clientAddress,
          subtotal: new Prisma.Decimal(subtotal),
          feePercent: new Prisma.Decimal(feePercent),
          feeAmount: new Prisma.Decimal(feeAmount),
          totalAmount: new Prisma.Decimal(totalAmount),
          feeModel,
          dueDate:
            dto.dueDate !== undefined
              ? dto.dueDate
                ? new Date(dto.dueDate)
                : null
              : existing.dueDate,
          notes:
            dto.notes !== undefined ? dto.notes : existing.notes,
          ...(dto.items && dto.items.length > 0
            ? {
                items: {
                  create: itemRows,
                },
              }
            : {}),
        },
        include: { items: { select: { id: true } } },
      });
    });
    await this.invalidateInvoiceAdminListCache();
    return updated;
  }

  /**
   * Cria um Stripe Payment Link: itens; em PASS_THROUGH acrescenta linha da taxa OX.
   * Em ABSORBED o cliente paga só o subtotal (taxa não aparece como linha extra no Stripe).
   */
  async createPaymentLink(
    invoice: Invoice & {
      items: { description: string; total: Prisma.Decimal }[];
    },
  ): Promise<{ id: string; url: string }> {
    const totalCents = Math.round(Number(invoice.totalAmount) * 100);
    if (totalCents < this.stripeService.minimumChargeAmountCents) {
      throw new BadRequestException(
        `Total abaixo do mínimo para cobrança (${this.stripeService.minimumChargeAmountCents / 100} ${this.stripeService.chargeCurrency.toUpperCase()})`,
      );
    }

    const lineItems: { name: string; amountCents: number }[] =
      invoice.items.map((row) => ({
        name: row.description,
        amountCents: Math.round(Number(row.total) * 100),
      }));

    if (
      Number(invoice.feeAmount) > 0 &&
      invoice.feeModel !== InvoiceFeeModel.ABSORBED
    ) {
      lineItems.push({
        name: 'Taxa de processamento (OX)',
        amountCents: Math.round(Number(invoice.feeAmount) * 100),
      });
    }

    const sumCents = lineItems.reduce((s, l) => s + l.amountCents, 0);
    if (sumCents !== totalCents) {
      this.logger.warn(
        `Invoice ${invoice.id}: soma das linhas (${sumCents}) ≠ total (${totalCents}) — ajustando última linha`,
      );
      const drift = totalCents - sumCents;
      if (lineItems.length > 0) {
        lineItems[lineItems.length - 1]!.amountCents += drift;
      }
    }

    const base =
      process.env.APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
    const successRedirectUrl =
      process.env.INVOICE_PAYMENT_SUCCESS_URL ??
      `${base}/pay/${invoice.id}/success`;

    return this.stripeService.createInvoicePaymentLink({
      invoiceId: invoice.id,
      projectId: invoice.projectId,
      currency: this.stripeService.chargeCurrency,
      lineItems,
      successRedirectUrl,
    });
  }

  /**
   * Gera (ou reutiliza) o link Stripe, marca a invoice como enviada.
   * Envio de e-mail: ETAPA 5 (Resend / notificações).
   */
  async sendInvoice(
    invoiceId: string,
    options?: { resendEmail?: boolean },
  ): Promise<{ url: string; publicToken: string }> {
    const inv = await this.prisma.invoice.findUnique({
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
    if (!inv) throw new NotFoundException('Invoice não encontrada');

    if (inv.status === 'paid') {
      throw new BadRequestException('Invoice já está paga');
    }
    if (inv.status === 'cancelled') {
      throw new BadRequestException('Invoice cancelada');
    }

    this.assertToconlineFiscalReady(inv);

    const publicToken = this.signPublicToken(invoiceId);

    const payBase = process.env.INVOICE_PAY_PUBLIC_BASE_URL?.trim();
    const buildPayUrl = (stripeUrl: string) =>
      payBase
        ? `${payBase.replace(/\/$/, '')}/${invoiceId}?token=${encodeURIComponent(publicToken)}`
        : stripeUrl;

    const sendChargeEmail = async (stripeUrl: string) => {
      const payUrl = buildPayUrl(stripeUrl);
      const totalAmountLabel = new Intl.NumberFormat('pt-PT', {
        style: 'currency',
        currency: this.stripeService.chargeCurrency.toUpperCase(),
      }).format(Number(inv.totalAmount));

      const emailResult = await this.emailService.sendInvoiceChargeEmail({
        to: inv.clientEmail,
        clientName: inv.clientName,
        contractorName: inv.project.organization?.name ?? 'Equipa OX',
        projectTitle: inv.project.title,
        invoiceNumber: inv.number,
        totalAmountLabel,
        payUrl,
        dueDateLabel: inv.dueDate
          ? inv.dueDate.toLocaleDateString('pt-PT', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })
          : null,
        notes: inv.notes,
      });

      this.logger.log(
        `Invoice ${inv.number} e-mail: ${emailResult.sent ? 'ok' : emailResult.skippedReason ?? 'não enviado'} — ${inv.clientEmail}`,
      );
    };

    if (inv.status === 'sent' && inv.stripePaymentLinkUrl) {
      const url = inv.stripePaymentLinkUrl;
      if (options?.resendEmail) {
        await sendChargeEmail(url);
      }
      return { url, publicToken };
    }

    const { id: linkId, url } = await this.createPaymentLink(inv);

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        stripePaymentLinkId: linkId,
        stripePaymentLinkUrl: url,
        status: 'sent',
      },
    });

    await sendChargeEmail(url);

    this.logger.log(
      `Invoice ${inv.number} enviada com Stripe Payment Link — ${inv.clientEmail}`,
    );

    await this.invalidateInvoiceAdminListCache();

    this.eventEmitter.emit('invoice.sent', { invoiceId });

    return { url, publicToken };
  }

  async markAsPaid(invoiceId: string, paymentIntentId: string): Promise<void> {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv) {
      this.logger.warn(`markAsPaid: invoice ${invoiceId} não encontrada`);
      return;
    }
    if (inv.status === 'paid') return;
    if (inv.status === 'cancelled') {
      this.logger.warn(`markAsPaid: invoice ${invoiceId} está cancelada — ignorando`);
      return;
    }

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'paid',
        paidAt: new Date(),
        stripePaymentIntentId: paymentIntentId,
      },
    });

    await this.invalidateInvoiceAdminListCache();

    this.eventEmitter.emit('invoice.paid', { invoiceId, paymentIntentId });
  }

  async cancelInvoice(invoiceId: string): Promise<void> {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv) throw new NotFoundException('Invoice não encontrada');
    if (inv.status === 'paid') {
      throw new BadRequestException('Não é possível cancelar invoice paga');
    }
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'cancelled' },
    });

    await this.invalidateInvoiceAdminListCache();
  }

  async listByProject(projectId: string) {
    return this.prisma.invoice.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }],
      include: { items: true },
    });
  }

  async listAllAdmin() {
    return this.cache.cacheGet('invoices:list:admin', 30, () =>
      this.prisma.invoice.findMany({
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          number: true,
          projectId: true,
          phaseId: true,
          clientName: true,
          clientEmail: true,
          clientPhone: true,
          clientNif: true,
          clientAddress: true,
          status: true,
          subtotal: true,
          feePercent: true,
          feeAmount: true,
          totalAmount: true,
          feeModel: true,
          dueDate: true,
          paidAt: true,
          notes: true,
          stripePaymentLinkUrl: true,
          toconlineDocId: true,
          toconlineDocNumber: true,
          toconlineStatus: true,
          toconlinePdfUrl: true,
          createdAt: true,
          project: { select: { id: true, title: true } },
        },
      }),
    );
  }

  async findOneAdmin(invoiceId: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        project: { select: { id: true, title: true, status: true } },
        phase: { select: { id: true, name: true, order: true } },
      },
    });
    if (!inv) throw new NotFoundException('Invoice não encontrada');
    return inv;
  }

  async getPublicInvoice(invoiceId: string, token: string | undefined) {
    if (!this.verifyPublicToken(invoiceId, token)) {
      throw new ForbiddenException('Token inválido ou ausente');
    }
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        project: { select: { title: true } },
      },
    });
    if (!inv) throw new NotFoundException('Invoice não encontrada');
    if (inv.status === 'draft' || inv.status === 'cancelled') {
      throw new ForbiddenException('Invoice não disponível');
    }

    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      clientName: inv.clientName,
      projectTitle: inv.project.title,
      items: inv.items.map((row) => ({
        description: row.description,
        quantity: Number(row.quantity),
        unitPrice: Number(row.unitPrice),
        total: Number(row.total),
      })),
      subtotal: Number(inv.subtotal),
      feePercent: Number(inv.feePercent),
      feeAmount: Number(inv.feeAmount),
      totalAmount: Number(inv.totalAmount),
      feeModel: inv.feeModel,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
      stripePaymentLinkUrl: inv.stripePaymentLinkUrl,
    };
  }

  async createPublicPaymentIntent(invoiceId: string, token: string | undefined) {
    if (!this.verifyPublicToken(invoiceId, token)) {
      throw new ForbiddenException('Token inválido ou ausente');
    }
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv) throw new NotFoundException('Invoice não encontrada');
    if (inv.status === 'paid') {
      throw new BadRequestException('Invoice já está paga');
    }
    if (inv.status === 'draft' || inv.status === 'cancelled') {
      throw new BadRequestException('Invoice não pode ser paga neste estado');
    }

    const amountCents = Math.round(Number(inv.totalAmount) * 100);
    if (amountCents < this.stripeService.minimumChargeAmountCents) {
      throw new BadRequestException(
        `Total abaixo do mínimo para cobrança (${this.stripeService.minimumChargeAmountCents / 100} ${this.stripeService.chargeCurrency.toUpperCase()})`,
      );
    }

    const intent = await this.stripeService.createInvoiceCheckoutPaymentIntent({
      amountCents,
      invoiceId: inv.id,
      projectId: inv.projectId,
    });

    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amount: Number(inv.totalAmount),
      currency: this.stripeService.chargeCurrency,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
    };
  }

  async deleteDraft(invoiceId: string): Promise<void> {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv) throw new NotFoundException('Invoice não encontrada');
    if (inv.status !== 'draft') {
      throw new BadRequestException('Só é possível apagar invoices em rascunho');
    }
    await this.prisma.invoice.delete({ where: { id: invoiceId } });

    await this.invalidateInvoiceAdminListCache();
  }

  /** Últimas 4 janelas de 7 dias: cobrado (paidAt) vs novas em aberto (criadas enviadas/pendentes). */
  private async buildWeeklyInvoiceBuckets(): Promise<
    { week: string; paid: number; pending: number }[]
  > {
    const now = new Date();
    const buckets: { week: string; paid: number; pending: number }[] = [];

    for (let i = 3; i >= 0; i--) {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      weekEnd.setHours(23, 59, 59, 999);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 7);
      weekStart.setHours(0, 0, 0, 0);

      const [paidAgg, pendingAgg] = await Promise.all([
        this.prisma.invoice.aggregate({
          where: {
            status: 'paid',
            paidAt: { gte: weekStart, lte: weekEnd },
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.invoice.aggregate({
          where: {
            status: { in: ['sent', 'overdue'] },
            createdAt: { gte: weekStart, lte: weekEnd },
          },
          _sum: { totalAmount: true },
        }),
      ]);

      buckets.push({
        week: `Sem ${4 - i}`,
        paid: Number(paidAgg._sum.totalAmount ?? 0),
        pending: Number(pendingAgg._sum.totalAmount ?? 0),
      });
    }

    return buckets;
  }

  async getInvoiceStats(): Promise<InvoiceStats> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [grouped, paidMonth, outstanding, awaiting, weeklyData] =
      await Promise.all([
        this.prisma.invoice.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.invoice.aggregate({
          where: {
            status: 'paid',
            paidAt: { gte: startOfMonth },
          },
          _count: { _all: true },
          _sum: { totalAmount: true },
        }),
        this.prisma.invoice.aggregate({
          where: { status: { in: ['draft', 'sent', 'overdue'] } },
          _sum: { totalAmount: true },
        }),
        this.prisma.invoice.aggregate({
          where: { status: { in: ['sent', 'overdue'] } },
          _sum: { totalAmount: true },
        }),
        this.buildWeeklyInvoiceBuckets(),
      ]);

    const counts: Record<InvoiceStatus, number> = {
      draft: 0,
      sent: 0,
      paid: 0,
      cancelled: 0,
      overdue: 0,
    };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }

    return {
      counts,
      paidThisMonthCount: paidMonth._count._all,
      paidThisMonthTotal: Number(paidMonth._sum.totalAmount ?? 0),
      outstandingTotal: Number(outstanding._sum.totalAmount ?? 0),
      awaitingPaymentTotal: Number(awaiting._sum.totalAmount ?? 0),
      contractorTransferredTotal: 0,
      weeklyData,
    };
  }
}
