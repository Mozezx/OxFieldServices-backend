import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Prisma, UserRole } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EvidenceGpsDto } from './dto/evidence-gps.dto';
import { UpdateAnnotationsDto } from './dto/update-annotations.dto';
import { CreateEvidenceCommentDto } from './dto/create-evidence-comment.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AI_CAPTION_QUEUE } from '../ai/ai.constants';

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
    private notifications: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(AI_CAPTION_QUEUE) private readonly aiCaptionQueue: Queue,
  ) {}

  async upload(
    phaseId: string,
    file: Express.Multer.File,
    userId: string,
    req?: any,
    gps?: EvidenceGpsDto,
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

    if (phase.status === 'completed') {
      throw new BadRequestException(
        'Upload não permitido em fase já concluída.',
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
        ...this.gpsToCreateData(gps),
      },
    });

    if (!isVideo && file.mimetype.startsWith('image/')) {
      void this.enqueueAiCaption(evidence.id);
    }

    this.eventEmitter.emit('phase.evidence_uploaded', {
      phaseId,
      evidenceId: evidence.id,
      projectId: phase.projectId,
    });

    return evidence;
  }

  /** Membro da organização do projeto da evidência (para endpoints de IA). */
  async ensureEvidenceOrgAccess(evidenceId: string, userId: string) {
    return this.assertEvidenceInUserOrg(evidenceId, userId);
  }

  private async enqueueAiCaption(evidenceId: string) {
    try {
      await this.aiCaptionQueue.add(
        { evidenceId },
        { removeOnComplete: true, removeOnFail: 50, attempts: 2, backoff: { type: 'exponential', delay: 4000 } },
      );
    } catch (err) {
      console.warn('[evidence] Falha ao enfileirar legenda IA:', err);
    }
  }

  /**
   * Atualiza GPS da evidência. Exige que o projeto pertença à organização do utilizador
   * e que este seja o autor do upload ou admin da mesma organização.
   */
  async updateLocation(evidenceId: string, userId: string, dto: EvidenceGpsDto) {
    const { evidence, memberships } = await this.assertEvidenceInUserOrg(evidenceId, userId);
    this.assertOwnerOrOrgAdmin(evidence.uploadedBy, userId, memberships);

    const data = this.gpsToUpdateData(dto);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Envie pelo menos um campo de localização.');
    }

    return this.prisma.phaseEvidence.update({
      where: { id: evidenceId },
      data,
    });
  }

  async updateAnnotations(evidenceId: string, userId: string, dto: UpdateAnnotationsDto) {
    const { evidence, memberships } = await this.assertEvidenceInUserOrg(evidenceId, userId);
    this.assertOwnerOrOrgAdmin(evidence.uploadedBy, userId, memberships);

    return this.prisma.phaseEvidence.update({
      where: { id: evidenceId },
      data: {
        annotationData: dto.annotationData as Prisma.InputJsonValue,
      },
    });
  }

  async listComments(evidenceId: string, userId: string) {
    await this.assertEvidenceInUserOrg(evidenceId, userId);

    return this.prisma.evidenceComment.findMany({
      where: { evidenceId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        evidenceId: true,
        authorId: true,
        content: true,
        voiceUrl: true,
        transcript: true,
        createdAt: true,
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async createComment(evidenceId: string, userId: string, dto: CreateEvidenceCommentDto) {
    const { evidence } = await this.assertEvidenceInUserOrg(evidenceId, userId);

    const comment = await this.prisma.evidenceComment.create({
      data: {
        evidenceId,
        authorId: userId,
        content: dto.content.trim(),
        voiceUrl: dto.voiceUrl?.trim() || undefined,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    if (evidence.uploadedBy !== userId) {
      await this.notifications.create({
        userId: evidence.uploadedBy,
        type: 'evidence_commented',
        title: 'Comentário na evidência',
        body: `${comment.author.name} comentou na sua evidência.`,
        entityType: 'phase_evidence',
        entityId: evidenceId,
        data: {
          authorName: comment.author.name,
          phaseName: evidence.phase.name,
          projectTitle: evidence.phase.project.title,
          commentId: comment.id,
          evidenceId,
          projectId: evidence.phase.projectId,
        },
      });
    }

    return comment;
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.evidenceComment.findUnique({
      where: { id: commentId },
      include: {
        evidence: {
          include: {
            phase: {
              include: {
                project: { select: { organizationId: true } },
              },
            },
          },
        },
      },
    });

    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comentário não encontrado');
    }

    const access = await this.assertEvidenceInUserOrg(comment.evidenceId, userId);

    const isAuthor = comment.authorId === userId;
    const isOrgAdmin = access.memberships.some((m) => m.role === 'admin');
    const isGlobalAdmin = access.appUser.role === 'admin';
    if (!isAuthor && !isOrgAdmin) {
      if (!isGlobalAdmin) {
        throw new ForbiddenException('Sem permissão para remover este comentário');
      }
    }

    await this.prisma.evidenceComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    return { deleted: true };
  }

  /** Evidência existe e o utilizador tem acesso por organização ou participação no projeto. */
  private async assertEvidenceInUserOrg(evidenceId: string, userId: string) {
    const appUser = await this.requireAppUser(userId);
    const evidence = await this.prisma.phaseEvidence.findUnique({
      where: { id: evidenceId },
      include: {
        phase: {
          select: {
            id: true,
            name: true,
            projectId: true,
            project: {
              select: {
                id: true,
                title: true,
                organizationId: true,
                clientId: true,
                contract: {
                  select: {
                    worker: {
                      select: { userId: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!evidence) throw new NotFoundException('Evidência não encontrada');

    const project = evidence.phase.project;
    const orgId = project.organizationId;
    const isOwnerClient =
      appUser.role === 'client' && project.clientId === appUser.id;
    const isAssignedWorker =
      appUser.role === 'worker' && project.contract?.worker?.userId === appUser.id;
    const isProjectParticipant = isOwnerClient || isAssignedWorker;

    if (!orgId) {
      // Compatibilidade com dados legados sem organizationId.
      if (isProjectParticipant || appUser.role === 'admin') {
        return { evidence, orgId, memberships: [], appUser };
      }
      throw new ForbiddenException('Sem permissão para esta evidência');
    }

    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId, organizationId: orgId },
      select: { organizationId: true, role: true },
    });

    const isOrgAdmin = memberships.some((m) => m.role === 'admin');
    if (isOrgAdmin) {
      return { evidence, orgId, memberships, appUser };
    }

    if (memberships.length > 0 && isProjectParticipant) {
      return { evidence, orgId, memberships, appUser };
    }

    // Compatibilidade para contas legadas sem membership, mas já participantes.
    if (memberships.length === 0 && isProjectParticipant) {
      return { evidence, orgId, memberships, appUser };
    }

    throw new ForbiddenException('Sem permissão para esta evidência');
  }

  private async requireAppUser(
    userKey: string,
  ): Promise<{ id: string; role: UserRole }> {
    const key = userKey?.trim();
    if (!key) {
      throw new ForbiddenException('Sessão inválida: identificador de utilizador em falta.');
    }
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: key }, { authId: key }] },
      select: { id: true, role: true },
    });
    if (!user) {
      throw new ForbiddenException(
        'Utilizador não encontrado na base de dados. Termine sessão, entre novamente ou faça POST /auth/sync.',
      );
    }
    return user;
  }

  private assertOwnerOrOrgAdmin(
    uploadedBy: string,
    userId: string,
    memberships: { role: string }[],
  ) {
    const isOwner = uploadedBy === userId;
    const isOrgAdmin = memberships.some((m) => m.role === 'admin');
    if (!isOwner && !isOrgAdmin) {
      throw new ForbiddenException('Sem permissão para esta ação');
    }
  }

  private gpsToCreateData(gps?: EvidenceGpsDto) {
    if (!gps) return {};
    const extra: {
      latitude?: number;
      longitude?: number;
      gpsAccuracy?: number;
      capturedAt?: Date;
    } = {};
    if (gps.latitude !== undefined) extra.latitude = gps.latitude;
    if (gps.longitude !== undefined) extra.longitude = gps.longitude;
    if (gps.gpsAccuracy !== undefined) extra.gpsAccuracy = gps.gpsAccuracy;
    if (gps.capturedAt !== undefined) extra.capturedAt = new Date(gps.capturedAt);
    return extra;
  }

  private gpsToUpdateData(dto: EvidenceGpsDto) {
    const data: {
      latitude?: number;
      longitude?: number;
      gpsAccuracy?: number;
      capturedAt?: Date;
    } = {};
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.gpsAccuracy !== undefined) data.gpsAccuracy = dto.gpsAccuracy;
    if (dto.capturedAt !== undefined) data.capturedAt = new Date(dto.capturedAt);
    return data;
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

    if (evidence.phase.status !== 'in_progress') {
      throw new BadRequestException(
        'Evidências só podem ser removidas enquanto a fase está em execução.',
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
