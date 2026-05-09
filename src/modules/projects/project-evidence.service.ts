import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { extname, join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp',
  'video/x-msvideo',
  'video/x-matroska',
];

const MAX_FILE_SIZE = 300 * 1024 * 1024;

export interface ProjectEvidenceGps {
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
  capturedAt?: string;
  note?: string;
}

export interface ProjectChecklistItem {
  id: string;
  label: string;
  done: boolean;
  requiresPhoto?: boolean;
  photoUrl?: string;
  order?: number;
}

@Injectable()
export class ProjectEvidenceService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  constructor(private prisma: PrismaService) {}

  async upload(
    projectId: string,
    file: Express.Multer.File,
    userId: string,
    req?: any,
    gps?: ProjectEvidenceGps,
  ) {
    if (!file) throw new BadRequestException('Arquivo é obrigatório.');

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de arquivo não permitido. Use jpeg, png, webp ou vídeo (mp4, mov, webm, 3gp, avi, mkv).',
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('Arquivo excede o limite de 300 MB.');
    }

    await this.assertProjectAccess(projectId, userId, ['worker', 'admin']);

    const isVideo = file.mimetype.startsWith('video/');
    let publicUrl: string;
    const latitude = this.parseOptionalFloat(gps?.latitude);
    const longitude = this.parseOptionalFloat(gps?.longitude);
    const gpsAccuracy = this.parseOptionalFloat(gps?.gpsAccuracy);
    const capturedAt = gps?.capturedAt ? new Date(gps.capturedAt) : undefined;

    if (isVideo) {
      publicUrl = await this.saveVideoLocally(projectId, file, req);
    } else {
      const ext = file.originalname.split('.').pop();
      const filename = `${Date.now()}.${ext}`;
      const path = `projects/${projectId}/${filename}`;

      const { error } = await this.supabase.storage
        .from('evidences')
        .upload(path, file.buffer, { contentType: file.mimetype });

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

    return this.prisma.projectEvidence.create({
      data: {
        projectId,
        type: file.mimetype,
        url: publicUrl,
        uploadedBy: userId,
        note: gps?.note,
        ...(latitude !== undefined && { latitude }),
        ...(longitude !== undefined && { longitude }),
        ...(gpsAccuracy !== undefined && { gpsAccuracy }),
        ...(capturedAt !== undefined &&
          !Number.isNaN(capturedAt.getTime()) && { capturedAt }),
      },
    });
  }

  async list(projectId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId, ['client', 'worker', 'admin']);
    return this.prisma.projectEvidence.findMany({
      where: { projectId },
      orderBy: { uploadedAt: 'desc' },
      include: {
        uploader: { select: { id: true, name: true, avatarUrl: true, role: true } },
        comments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true, avatarUrl: true } } },
        },
      },
    });
  }

  async remove(evidenceId: string, userId: string) {
    const evidence = await this.prisma.projectEvidence.findUnique({
      where: { id: evidenceId },
      include: { uploader: { select: { role: true } } },
    });
    if (!evidence) throw new NotFoundException('Evidência não encontrada');

    const appUser = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { authId: userId }] },
      select: { id: true, role: true },
    });
    if (!appUser) throw new ForbiddenException('Utilizador não encontrado');

    if (evidence.uploadedBy !== appUser.id && appUser.role !== 'admin') {
      throw new ForbiddenException('Sem permissão para remover esta evidência');
    }

    if (
      !evidence.url.includes('/uploads/evidences/') &&
      !evidence.url.includes('/uploads/projects/')
    ) {
      const storagePath = this.extractSupabasePath(evidence.url);
      if (storagePath) {
        await this.supabase.storage.from('evidences').remove([storagePath]);
      }
    }

    await this.prisma.projectEvidence.delete({ where: { id: evidenceId } });
    return { deleted: true };
  }

  async createComment(evidenceId: string, userId: string, content: string) {
    const evidence = await this.prisma.projectEvidence.findUnique({
      where: { id: evidenceId },
      select: { projectId: true },
    });
    if (!evidence) throw new NotFoundException('Evidência não encontrada');

    const appUser = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { authId: userId }] },
      select: { id: true },
    });
    if (!appUser) throw new ForbiddenException('Utilizador não encontrado');

    await this.assertProjectAccess(evidence.projectId, userId, ['client', 'worker', 'admin']);

    return this.prisma.projectEvidenceComment.create({
      data: { evidenceId, authorId: appUser.id, content: content.trim() },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async listComments(evidenceId: string, userId: string) {
    const evidence = await this.prisma.projectEvidence.findUnique({
      where: { id: evidenceId },
      select: { projectId: true },
    });
    if (!evidence) throw new NotFoundException('Evidência não encontrada');

    await this.assertProjectAccess(evidence.projectId, userId, ['client', 'worker', 'admin']);

    return this.prisma.projectEvidenceComment.findMany({
      where: { evidenceId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.projectEvidenceComment.findUnique({
      where: { id: commentId },
      select: { authorId: true, deletedAt: true },
    });
    if (!comment || comment.deletedAt) throw new NotFoundException('Comentário não encontrado');

    const appUser = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { authId: userId }] },
      select: { id: true, role: true },
    });
    if (!appUser) throw new ForbiddenException('Utilizador não encontrado');

    if (comment.authorId !== appUser.id && appUser.role !== 'admin') {
      throw new ForbiddenException('Sem permissão para remover este comentário');
    }

    await this.prisma.projectEvidenceComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  async getChecklist(projectId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId, ['client', 'worker', 'admin']);
    const checklist = await this.prisma.projectChecklist.findUnique({
      where: { projectId },
    });
    return checklist ?? { projectId, items: [] };
  }

  async upsertChecklist(projectId: string, userId: string, items: ProjectChecklistItem[]) {
    await this.assertProjectAccess(projectId, userId, ['worker', 'admin']);
    return this.prisma.projectChecklist.upsert({
      where: { projectId },
      create: { projectId, items: items as any },
      update: { items: items as any },
    });
  }

  private async assertProjectAccess(
    projectId: string,
    userId: string,
    allowedRoles: string[],
  ) {
    const appUser = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { authId: userId }] },
      select: { id: true, role: true },
    });
    if (!appUser) throw new ForbiddenException('Utilizador não encontrado');

    if (!allowedRoles.includes(appUser.role)) {
      throw new ForbiddenException('Sem permissão para este recurso');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        clientId: true,
        organizationId: true,
        contract: { select: { workerId: true } },
      },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    if (appUser.role === 'admin') return appUser;

    if (appUser.role === 'client' && project.clientId === appUser.id) return appUser;

    if (appUser.role === 'worker') {
      const worker = await this.prisma.worker.findUnique({
        where: { userId: appUser.id },
        select: { id: true },
      });
      if (!worker) {
        throw new ForbiddenException('Sem permissão para este projeto');
      }

      const assignment = await this.prisma.projectAssignment.findFirst({
        where: {
          projectId,
          workerId: worker.id,
          removedAt: null,
        },
      });
      if (assignment) return appUser;

      if (project.contract?.workerId === worker.id) return appUser;
    }

    throw new ForbiddenException('Sem permissão para este projeto');
  }

  private async saveVideoLocally(
    projectId: string,
    file: Express.Multer.File,
    req?: any,
  ): Promise<string> {
    const evidenceDir = join(process.cwd(), 'uploads', 'projects', projectId);
    await mkdir(evidenceDir, { recursive: true });
    const ext = extname(file.originalname) || '.mp4';
    const filename = `${Date.now()}${ext}`;
    await writeFile(join(evidenceDir, filename), file.buffer);
    const baseUrl = req?.headers?.host
      ? `${req.protocol ?? 'http'}://${req.headers.host}`
      : process.env.APP_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    return `${baseUrl}/uploads/projects/${projectId}/${filename}`;
  }

  private extractSupabasePath(url: string): string | null {
    try {
      return new URL(url).pathname.split('/object/public/evidences/')[1] ?? null;
    } catch {
      return null;
    }
  }

  private parseOptionalFloat(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }
}
