import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { DOCUMENT_OCR_QUEUE, type DocumentOcrJob } from './documents.constants';

const MAX_FILE_BYTES = 40 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/tif',
  'application/pdf',
]);

const OCR_MIME = new Set(['image/jpeg', 'image/png', 'image/tiff', 'image/tif']);

@Injectable()
export class DocumentsService {
  private readonly supabase;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly config: ConfigService,
    @InjectQueue(DOCUMENT_OCR_QUEUE)
    private readonly ocrQueue: Queue<DocumentOcrJob>,
  ) {
    const url = this.config.get<string>('SUPABASE_URL');
    const key =
      this.config.get<string>('SUPABASE_SERVICE_KEY') ??
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      throw new Error(
        'SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios para documentos.',
      );
    }
    this.supabase = createClient(url, key);
  }

  private bucket(): string {
    return this.config.get<string>('DOCUMENTS_STORAGE_BUCKET') ?? 'documents';
  }

  private sanitizeFileName(name: string): string {
    const base = name.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
    return base.slice(0, 180) || 'file';
  }

  storagePathFromPublicUrl(fileUrl: string): string | null {
    const b = this.bucket();
    const marker = `/object/public/${b}/`;
    const i = fileUrl.indexOf(marker);
    if (i === -1) return null;
    return decodeURIComponent(fileUrl.slice(i + marker.length));
  }

  async upload(
    projectId: string,
    userKey: string,
    file: Express.Multer.File,
    type: DocumentType,
    fileName: string,
    phaseId?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Ficheiro é obrigatório.');
    }

    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('Ficheiro excede o limite de 40 MB.');
    }

    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'Tipo não permitido. Use PDF, JPEG, PNG ou TIFF.',
      );
    }

    const { userId, organizationId } =
      await this.projectsService.ensureReportProjectAccess(projectId, userKey);

    if (phaseId) {
      const phase = await this.prisma.projectPhase.findFirst({
        where: { id: phaseId, projectId },
        select: { id: true },
      });
      if (!phase) {
        throw new BadRequestException('Fase inválida para este projeto.');
      }
    }

    const safeName = this.sanitizeFileName(fileName || file.originalname || 'document');
    const objectPath = `${organizationId}/${projectId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
    const bucket = this.bucket();

    const { error } = await this.supabase.storage.from(bucket).upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
      cacheControl: 'private, max-age=3600',
    });

    if (error) {
      throw new InternalServerErrorException(
        `Falha no upload para o storage: ${error.message}`,
      );
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(bucket).getPublicUrl(objectPath);

    const doc = await this.prisma.projectDocument.create({
      data: {
        projectId,
        phaseId: phaseId ?? null,
        fileUrl: publicUrl,
        fileName: fileName.trim() || safeName,
        type,
        uploadedBy: userId,
      },
    });

    if (OCR_MIME.has(file.mimetype)) {
      try {
        await this.ocrQueue.add(
          { documentId: doc.id, mimeType: file.mimetype },
          {
            removeOnComplete: true,
            removeOnFail: 50,
            attempts: 2,
            backoff: { type: 'exponential', delay: 8000 },
          },
        );
      } catch (err) {
        console.warn('[documents] Falha ao enfileirar OCR:', err);
      }
    }

    return this.formatDocument(doc);
  }

  async list(projectId: string, userKey: string, phaseId?: string) {
    await this.projectsService.ensureReportProjectAccess(projectId, userKey);

    if (phaseId) {
      const phase = await this.prisma.projectPhase.findFirst({
        where: { id: phaseId, projectId },
        select: { id: true },
      });
      if (!phase) {
        throw new BadRequestException('Fase inválida para este projeto.');
      }
    }

    const rows = await this.prisma.projectDocument.findMany({
      where: {
        projectId,
        ...(phaseId ? { phaseId } : {}),
      },
      orderBy: { uploadedAt: 'desc' },
    });

    return rows.map((r) => this.formatDocument(r));
  }

  async remove(projectId: string, docId: string, userKey: string) {
    const { userId } =
      await this.projectsService.ensureReportProjectAccess(projectId, userKey);

    const doc = await this.prisma.projectDocument.findFirst({
      where: { id: docId, projectId },
      include: {
        project: { select: { organizationId: true } },
      },
    });

    if (!doc) {
      throw new NotFoundException('Documento não encontrado.');
    }

    const orgId = doc.project.organizationId;
    if (!orgId) {
      throw new ForbiddenException('Projeto sem organização.');
    }

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId, organizationId: orgId },
      select: { role: true },
    });

    const isUploader = doc.uploadedBy === userId;
    const isOrgAdmin = membership?.role === UserRole.admin;

    if (!isUploader && !isOrgAdmin) {
      throw new ForbiddenException(
        'Apenas quem enviou o documento ou um admin da organização pode apagar.',
      );
    }

    const storagePath = this.storagePathFromPublicUrl(doc.fileUrl);
    if (storagePath) {
      const { error } = await this.supabase.storage
        .from(this.bucket())
        .remove([storagePath]);
      if (error) {
        console.warn(`[documents] Storage remove falhou: ${error.message}`);
      }
    }

    await this.prisma.projectDocument.delete({ where: { id: docId } });

    return { ok: true as const };
  }

  private formatDocument(doc: {
    id: string;
    projectId: string;
    phaseId: string | null;
    fileUrl: string;
    fileName: string;
    type: DocumentType;
    uploadedBy: string;
    uploadedAt: Date;
    ocrText: string | null;
  }) {
    return {
      id: doc.id,
      projectId: doc.projectId,
      phaseId: doc.phaseId,
      fileUrl: doc.fileUrl,
      fileName: doc.fileName,
      type: doc.type,
      uploadedBy: doc.uploadedBy,
      uploadedAt: doc.uploadedAt.toISOString(),
      ocrText: doc.ocrText,
    };
  }
}
