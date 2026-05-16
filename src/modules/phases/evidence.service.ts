import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Prisma, UserRole } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { extname } from 'path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EvidenceGpsDto } from './dto/evidence-gps.dto';
import { RegisterEvidenceDto } from './dto/register-evidence.dto';
import { UpdateAnnotationsDto } from './dto/update-annotations.dto';
import { CreateEvidenceCommentDto } from './dto/create-evidence-comment.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AI_CAPTION_QUEUE } from '../ai/ai.constants';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp',
  'video/x-msvideo',
  'video/x-matroska',
];

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300 MB

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);
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
      this.logger.warn(`[upload] phaseId=${phaseId} userId=${userId} → arquivo ausente`);
      throw new BadRequestException('Arquivo é obrigatório.');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      this.logger.warn(
        `[upload] phaseId=${phaseId} userId=${userId} → MIME rejeitado: ${file.mimetype} (${file.originalname}, ${file.size}b)`,
      );
      throw new BadRequestException(
        'Tipo de arquivo não permitido. Use jpeg, png, webp ou vídeo (mp4, mov, webm, 3gp, avi, mkv).',
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      this.logger.warn(
        `[upload] phaseId=${phaseId} userId=${userId} → arquivo grande: ${file.size}b (${file.originalname})`,
      );
      throw new BadRequestException('Arquivo excede o limite de 300 MB.');
    }

    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
      include: {
        project: { select: { status: true } },
      },
    });

    if (!phase) throw new NotFoundException('Fase não encontrada');

    if (phase.status === 'completed') {
      this.logger.warn(`[upload] phaseId=${phaseId} userId=${userId} → fase já concluída (status=${phase.status})`);
      throw new BadRequestException(
        'Upload não permitido em fase já concluída.',
      );
    }

    const isVideo = file.mimetype.startsWith('video/');
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

    const ext = extname(file.originalname) || (isVideo ? '.mp4' : '.bin');
    const filename = idempotencyKey
      ? `${idempotencyKey}${ext}`
      : `${Date.now()}${ext}`;
    const storagePath = `phases/${phaseId}/${filename}`;

    const { error: uploadError } = await this.supabase.storage
      .from('evidences')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: Boolean(idempotencyKey),
        cacheControl: 'public, max-age=31536000, immutable',
      });

    if (uploadError) {
      throw new InternalServerErrorException(
        `Falha no upload para o storage: ${uploadError.message}`,
      );
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from('evidences').getPublicUrl(storagePath);

    const evidence = await this.prisma.phaseEvidence.create({
      data: {
        phaseId,
        type: file.mimetype,
        url: publicUrl,
        uploadedBy: userId,
        ...this.gpsToCreateData(gps),
      },
    });

    if (file.mimetype.startsWith('image/')) {
      void this.enqueueAiCaption(evidence.id);
    }

    this.eventEmitter.emit('phase.evidence_uploaded', {
      phaseId,
      evidenceId: evidence.id,
      projectId: phase.projectId,
    });

    return evidence;
  }

  /** Registra evidência já enviada diretamente ao Supabase Storage (upload direto). */
  async register(
    phaseId: string,
    userId: string,
    dto: RegisterEvidenceDto,
    req?: any,
  ) {
    const idempotencyKey = this.extractIdempotencyKey(req);

    if (!ALLOWED_MIME_TYPES.includes(dto.mimeType)) {
      throw new BadRequestException(
        'Tipo de arquivo não permitido. Use jpeg, png, webp ou vídeo (mp4, mov, webm, 3gp, avi, mkv).',
      );
    }

    if (dto.size > MAX_FILE_SIZE) {
      throw new BadRequestException('Arquivo excede o limite de 300 MB.');
    }

    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
      include: { project: { select: { status: true, id: true } } },
    });

    if (!phase) throw new NotFoundException('Fase não encontrada');

    if (phase.status === 'completed') {
      throw new BadRequestException('Upload não permitido em fase já concluída.');
    }

    if (idempotencyKey) {
      const existing = await this.prisma.phaseEvidence.findFirst({
        where: {
          phaseId,
          uploadedBy: userId,
          url: { contains: idempotencyKey },
        },
      });
      if (existing) return existing;
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from('evidences').getPublicUrl(dto.storagePath);

    const evidence = await this.prisma.phaseEvidence.create({
      data: {
        phaseId,
        type: dto.mimeType,
        url: publicUrl,
        uploadedBy: userId,
        ...this.gpsToCreateData({
          latitude: dto.latitude,
          longitude: dto.longitude,
          gpsAccuracy: dto.gpsAccuracy,
          capturedAt: dto.capturedAt,
        }),
      },
    });

    if (dto.mimeType.startsWith('image/')) {
      void this.enqueueAiCaption(evidence.id);
    }

    this.eventEmitter.emit('phase.evidence_uploaded', {
      phaseId,
      evidenceId: evidence.id,
      projectId: phase.project.id,
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

    const storagePath = this.extractSupabasePath(evidence.url);
    if (storagePath) {
      await this.supabase.storage.from('evidences').remove([storagePath]);
    }

    await this.prisma.phaseEvidence.delete({ where: { id: evidenceId } });

    return { deleted: true };
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
