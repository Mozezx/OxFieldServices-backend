import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
];

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300 MB
const MIN_VIDEO_DURATION_SECONDS = 30;
const MAX_VIDEO_DURATION_SECONDS = 90;

@Injectable()
export class EvidenceService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  constructor(
    private prisma: PrismaService,
  ) {}

  async upload(
    phaseId: string,
    file: Express.Multer.File,
    userId: string,
    req?: any,
  ) {
    const idempotencyKey = this.extractIdempotencyKey(req);
    if (!file) {
      throw new BadRequestException('Arquivo é obrigatório.');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de arquivo não permitido. Use jpeg, png, webp, mp4 ou mov.',
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('Arquivo excede o limite de 300 MB.');
    }

    if (file.mimetype.startsWith('video/')) {
      const durationSeconds = this.readMp4DurationSeconds(file.buffer);
      if (durationSeconds === null) {
        throw new BadRequestException(
          'Não foi possível validar a duração do vídeo. Use MP4 ou MOV válido.',
        );
      }
      if (
        durationSeconds < MIN_VIDEO_DURATION_SECONDS ||
        durationSeconds > MAX_VIDEO_DURATION_SECONDS
      ) {
        throw new BadRequestException(
          'Vídeo deve ter entre 30 segundos e 1 minuto e 30 segundos.',
        );
      }
    }

    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
      include: {
        project: { select: { status: true } },
      },
    });

    if (!phase) throw new NotFoundException('Fase não encontrada');

    // Só permite upload quando a fase está em progresso ou rejeitada (reenvio)
    if (phase.status !== 'in_progress' && phase.status !== 'rejected') {
      throw new BadRequestException(
        'Upload permitido apenas em fases com status in_progress ou rejected.',
      );
    }

    const isVideo = file.mimetype.startsWith('video/');
    let publicUrl: string;
    if (idempotencyKey) {
      const existing = await this.prisma.phaseEvidence.findFirst({
        where: {
          phaseId,
          uploadedBy: userId,
          type: file.mimetype,
          url: { contains: idempotencyKey },
        },
      });
      if (existing) return existing;
    }

    if (isVideo) {
      publicUrl = await this.saveVideoLocally(phaseId, file, req, idempotencyKey);
    } else {
      const ext = file.originalname.split('.').pop();
      const filename = idempotencyKey
        ? `${idempotencyKey}.${ext}`
        : `${Date.now()}.${ext}`;
      const path = `phases/${phaseId}/${filename}`;

      const { error } = await this.supabase.storage
        .from('evidences')
        .upload(path, file.buffer, {
          contentType: file.mimetype,
          upsert: Boolean(idempotencyKey),
        });

      if (error) {
        throw new InternalServerErrorException(
          `Falha no upload para o storage: ${error.message}`,
        );
      }

      const {
        data: { publicUrl: storageUrl },
      } = this.supabase.storage.from('evidences').getPublicUrl(path);
      publicUrl = storageUrl;
    }

    const evidence = await this.prisma.phaseEvidence.create({
      data: {
        phaseId,
        type: file.mimetype,
        url: publicUrl,
        uploadedBy: userId,
      },
    });

    return evidence;
  }

  private readMp4DurationSeconds(buffer: Buffer): number | null {
    const mvhd = this.findBox(buffer, ['moov', 'mvhd']);
    if (!mvhd) return null;

    const version = mvhd[0];
    if (version === 0) {
      if (mvhd.length < 20) return null;
      const timescale = mvhd.readUInt32BE(12);
      const duration = mvhd.readUInt32BE(16);
      if (!timescale) return null;
      return duration / timescale;
    }

    if (version === 1) {
      if (mvhd.length < 32) return null;
      const timescale = mvhd.readUInt32BE(20);
      const duration = Number(mvhd.readBigUInt64BE(24));
      if (!timescale) return null;
      return duration / timescale;
    }

    return null;
  }

  private findBox(buffer: Buffer, path: string[]): Buffer | null {
    let current = buffer;
    for (const type of path) {
      const next = this.findChildBox(current, type);
      if (!next) return null;
      current = next;
    }
    return current;
  }

  private findChildBox(buffer: Buffer, targetType: string): Buffer | null {
    let offset = 0;
    while (offset + 8 <= buffer.length) {
      let size = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      let headerSize = 8;

      if (size === 1) {
        if (offset + 16 > buffer.length) return null;
        size = Number(buffer.readBigUInt64BE(offset + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = buffer.length - offset;
      }

      if (size < headerSize) return null;
      const end = offset + size;
      if (end > buffer.length) return null;

      if (type === targetType) {
        return buffer.subarray(offset + headerSize, end);
      }

      offset = end;
    }

    return null;
  }

  async findByPhase(phaseId: string) {
    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
    });

    if (!phase) throw new NotFoundException('Fase não encontrada');

    return this.prisma.phaseEvidence.findMany({
      where: { phaseId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async remove(evidenceId: string, userId: string) {
    const evidence = await this.prisma.phaseEvidence.findUnique({
      where: { id: evidenceId },
      include: {
        phase: { select: { status: true } },
        uploader: { select: { role: true } },
      },
    });

    if (!evidence) throw new NotFoundException('Evidência não encontrada');

    if (evidence.uploadedBy !== userId && evidence.uploader.role !== 'admin') {
      throw new ForbiddenException('Sem permissão para remover esta evidência');
    }

    if (
      evidence.phase.status !== 'in_progress' &&
      evidence.phase.status !== 'evidence_uploaded' &&
      evidence.phase.status !== 'rejected'
    ) {
      throw new BadRequestException(
        'Evidências só podem ser removidas antes da revisão.',
      );
    }

    if (this.isLocalEvidenceUrl(evidence.url)) {
      await this.removeLocalEvidence(evidence.url);
    } else {
      const storagePath = this.extractSupabasePath(evidence.url);
      if (storagePath) {
        await this.supabase.storage.from('evidences').remove([storagePath]);
      }
    }

    await this.prisma.phaseEvidence.delete({ where: { id: evidenceId } });

    return { deleted: true };
  }

  private async saveVideoLocally(
    phaseId: string,
    file: Express.Multer.File,
    req?: any,
    idempotencyKey?: string,
  ): Promise<string> {
    const uploadsRoot = join(process.cwd(), 'uploads');
    const evidenceDir = join(uploadsRoot, 'evidences', phaseId);
    await mkdir(evidenceDir, { recursive: true });

    const ext = extname(file.originalname) || '.mp4';
    const filename = idempotencyKey
      ? `${idempotencyKey}${ext}`
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    const absolutePath = join(evidenceDir, filename);
    await writeFile(absolutePath, file.buffer);

    const baseUrl = this.resolvePublicBaseUrl(req);
    return `${baseUrl}/uploads/evidences/${phaseId}/${filename}`;
  }

  private resolvePublicBaseUrl(req?: any): string {
    if (process.env.APP_PUBLIC_URL) {
      return process.env.APP_PUBLIC_URL.replace(/\/$/, '');
    }

    const forwardedProto = req?.headers?.['x-forwarded-proto'];
    const proto =
      typeof forwardedProto === 'string'
        ? forwardedProto.split(',')[0].trim()
        : req?.protocol ?? 'http';
    const host = req?.headers?.host as string | undefined;
    if (host) {
      return `${proto}://${host}`;
    }

    if (process.env.APP_URL) {
      return process.env.APP_URL.replace(/\/$/, '');
    }

    return `http://localhost:${process.env.PORT ?? 3000}`;
  }

  private isLocalEvidenceUrl(url: string): boolean {
    return url.includes('/uploads/evidences/');
  }

  private async removeLocalEvidence(url: string): Promise<void> {
    try {
      const parsed = new URL(url);
      const marker = '/uploads/evidences/';
      const rel = parsed.pathname.split(marker)[1];
      if (!rel) return;
      const abs = join(process.cwd(), 'uploads', 'evidences', rel);
      await unlink(abs);
    } catch {
      // Falha ao remover arquivo local não bloqueia exclusão do registro.
    }
  }

  private extractSupabasePath(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.pathname.split('/object/public/evidences/')[1] ?? null;
    } catch {
      return null;
    }
  }

  private extractIdempotencyKey(req?: any): string | undefined {
    const value = req?.headers?.['x-idempotency-key'];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }
}
