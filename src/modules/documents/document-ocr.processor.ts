import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { createWorker } from 'tesseract.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DOCUMENT_OCR_QUEUE, type DocumentOcrJob } from './documents.constants';

const OCR_MIME = new Set(['image/jpeg', 'image/png', 'image/tiff', 'image/tif']);

@Processor(DOCUMENT_OCR_QUEUE)
@Injectable()
export class DocumentOcrProcessor {
  private readonly logger = new Logger(DocumentOcrProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process({ concurrency: 1 })
  async handle(job: Job<DocumentOcrJob>) {
    const { documentId, mimeType } = job.data;

    if (!OCR_MIME.has(mimeType)) {
      return;
    }

    const doc = await this.prisma.projectDocument.findUnique({
      where: { id: documentId },
      select: { id: true, fileUrl: true, ocrText: true },
    });

    if (!doc) {
      this.logger.warn(`Documento ${documentId} não encontrado para OCR.`);
      return;
    }

    if (doc.ocrText != null && doc.ocrText.length > 0) {
      return;
    }

    let buffer: Buffer;
    try {
      const res = await fetch(doc.fileUrl, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const arr = await res.arrayBuffer();
      buffer = Buffer.from(arr);
    } catch (e) {
      this.logger.warn(
        `OCR download falhou (${documentId}): ${(e as Error).message}`,
      );
      return;
    }

    let text = '';
    try {
      const worker = await createWorker('por', undefined, {
        logger: () => {},
      });
      try {
        const {
          data: { text: out },
        } = await worker.recognize(buffer);
        text = (out ?? '').trim();
      } finally {
        await worker.terminate();
      }
    } catch (e) {
      this.logger.warn(`OCR tesseract falhou (${documentId}): ${(e as Error).message}`);
      return;
    }

    await this.prisma.projectDocument.update({
      where: { id: documentId },
      data: { ocrText: text || null },
    });
  }
}
