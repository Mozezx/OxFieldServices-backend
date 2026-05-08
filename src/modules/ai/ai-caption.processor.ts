import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from './ai.service';
import { AI_CAPTION_QUEUE } from './ai.constants';

@Processor(AI_CAPTION_QUEUE)
export class AiCaptionProcessor {
  private readonly log = new Logger(AiCaptionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  @Process()
  async handle(job: Job<{ evidenceId: string }>) {
    const { evidenceId } = job.data;
    try {
      const ev = await this.prisma.phaseEvidence.findUnique({
        where: { id: evidenceId },
        include: {
          phase: { select: { name: true } },
        },
      });
      if (!ev) return;
      if (!ev.type.startsWith('image/')) return;

      const caption = await this.ai.generateEvidenceCaption(
        ev.url,
        `Fase: ${ev.phase.name}`,
      );

      await this.prisma.phaseEvidence.update({
        where: { id: evidenceId },
        data: { aiCaption: caption },
      });
    } catch (err) {
      this.log.warn(
        `[ai-caption] job ${job.id} evidence ${job.data.evidenceId}: ${String((err as Error).message)}`,
      );
      // Não relançar: evita reprocessamento agressivo; upload já foi bem-sucedido.
    }
  }
}
