import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, SignatureTarget } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateSignatureDto } from './dto/create-signature.dto';

@Injectable()
export class SignaturesService {
  private readonly supabase;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly config: ConfigService,
  ) {
    const url = this.config.get<string>('SUPABASE_URL');
    const key =
      this.config.get<string>('SUPABASE_SERVICE_KEY') ??
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      throw new Error(
        'SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios para assinaturas.',
      );
    }
    this.supabase = createClient(url, key);
  }

  private async resolveEntityScope(
    entityType: SignatureTarget,
    entityId: string,
  ): Promise<{ projectId: string; organizationId: string }> {
    switch (entityType) {
      case SignatureTarget.PHASE_VALIDATION: {
        const phase = await this.prisma.projectPhase.findUnique({
          where: { id: entityId },
          select: {
            projectId: true,
            project: { select: { organizationId: true } },
          },
        });
        if (!phase) {
          throw new NotFoundException('Fase não encontrada.');
        }
        const organizationId = phase.project.organizationId;
        if (!organizationId) {
          throw new ForbiddenException('Projeto sem organização.');
        }
        return { projectId: phase.projectId, organizationId };
      }
      case SignatureTarget.CONTRACT: {
        const contract = await this.prisma.contract.findUnique({
          where: { id: entityId },
          select: {
            projectId: true,
            project: { select: { organizationId: true } },
          },
        });
        if (!contract) {
          throw new NotFoundException('Contrato não encontrado.');
        }
        const organizationId = contract.project.organizationId;
        if (!organizationId) {
          throw new ForbiddenException('Projeto sem organização.');
        }
        return { projectId: contract.projectId, organizationId };
      }
      case SignatureTarget.PROJECT_REPORT: {
        const report = await this.prisma.projectReport.findUnique({
          where: { id: entityId },
          select: { projectId: true, organizationId: true },
        });
        if (!report) {
          throw new NotFoundException('Relatório não encontrado.');
        }
        return {
          projectId: report.projectId,
          organizationId: report.organizationId,
        };
      }
      case SignatureTarget.INSPECTION: {
        const doc = await this.prisma.projectDocument.findUnique({
          where: { id: entityId },
          select: {
            type: true,
            projectId: true,
            project: { select: { organizationId: true } },
          },
        });
        if (!doc || doc.type !== DocumentType.INSPECTION) {
          throw new NotFoundException('Documento de inspeção não encontrado.');
        }
        const organizationId = doc.project.organizationId;
        if (!organizationId) {
          throw new ForbiddenException('Projeto sem organização.');
        }
        return { projectId: doc.projectId, organizationId };
      }
    }
  }

  private async signaturePayloadToPngBuffer(signatureData: string): Promise<Buffer> {
    const raw = signatureData.trim();
    const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(raw);

    let bytes: Buffer | undefined;
    let declaredMime: string | undefined;

    if (dataUrl) {
      declaredMime = dataUrl[1].toLowerCase();
      try {
        bytes = Buffer.from(dataUrl[2], 'base64');
      } catch {
        throw new BadRequestException('Base64 inválido na data URL.');
      }
    } else {
      const compact = raw.replace(/\s/g, '');
      if (compact.length >= 64 && /^[A-Za-z0-9+/]+=*$/.test(compact)) {
        try {
          const b = Buffer.from(compact, 'base64');
          if (b.length > 0) bytes = b;
        } catch {
          /* treat as SVG text */
        }
      }
    }

    const isPngMagic = (b: Buffer) =>
      b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpegMagic = (b: Buffer) => b.length >= 2 && b[0] === 0xff && b[1] === 0xd8;

    if (bytes?.length) {
      if (isPngMagic(bytes)) return bytes;
      if (isJpegMagic(bytes) || declaredMime?.includes('jpeg')) {
        try {
          return await sharp(bytes).png().toBuffer();
        } catch (e) {
          throw new BadRequestException(
            `Não foi possível converter a imagem para PNG: ${(e as Error).message}`,
          );
        }
      }
      if (declaredMime?.includes('svg')) {
        try {
          return await sharp(bytes).png().toBuffer();
        } catch (e) {
          throw new BadRequestException(
            `SVG inválido: ${(e as Error).message}`,
          );
        }
      }
      const asText = bytes.toString('utf8').trim();
      if (asText.includes('<svg')) {
        try {
          return await sharp(Buffer.from(asText, 'utf8')).png().toBuffer();
        } catch (e) {
          throw new BadRequestException(
            `SVG inválido: ${(e as Error).message}`,
          );
        }
      }
    }

    if (raw.includes('<svg') || raw.trimStart().startsWith('<?xml')) {
      try {
        return await sharp(Buffer.from(raw, 'utf8')).png().toBuffer();
      } catch (e) {
        throw new BadRequestException(`SVG inválido: ${(e as Error).message}`);
      }
    }

    if (declaredMime?.includes('png') && bytes?.length && isPngMagic(bytes)) {
      return bytes;
    }

    throw new BadRequestException(
      'signatureData deve ser PNG ou JPEG em base64/data URL, ou SVG (texto ou base64).',
    );
  }

  private clientIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded[0]) {
      return forwarded[0].split(',')[0].trim();
    }
    if (typeof req.ip === 'string' && req.ip.length > 0) {
      return req.ip;
    }
    return req.socket?.remoteAddress ?? null;
  }

  async create(userKey: string, dto: CreateSignatureDto, req: Request) {
    const { projectId, organizationId } = await this.resolveEntityScope(
      dto.entityType,
      dto.entityId,
    );

    const { userId } = await this.projectsService.ensureReportProjectAccess(
      projectId,
      userKey,
    );

    const existing = await this.prisma.digitalSignature.findFirst({
      where: {
        signerId: userId,
        entityType: dto.entityType,
        entityId: dto.entityId,
      },
    });
    if (existing) {
      throw new ConflictException(
        'Já existe assinatura deste utilizador para esta entidade.',
      );
    }

    const png = await this.signaturePayloadToPngBuffer(dto.signatureData);
    const bucket =
      this.config.get<string>('SIGNATURES_STORAGE_BUCKET') ?? 'signatures';
    const objectPath = `orgs/${organizationId}/${dto.entityType}/${dto.entityId}/${randomUUID()}.png`;

    const { error } = await this.supabase.storage.from(bucket).upload(objectPath, png, {
      contentType: 'image/png',
      upsert: false,
    });

    if (error) {
      throw new InternalServerErrorException(
        `Falha no upload da assinatura: ${error.message}`,
      );
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(bucket).getPublicUrl(objectPath);

    const row = await this.prisma.digitalSignature.create({
      data: {
        signatureData: publicUrl,
        signerName: dto.signerName,
        signerId: userId,
        signerRole: dto.signerRole,
        entityType: dto.entityType,
        entityId: dto.entityId,
        ipAddress: this.clientIp(req),
      },
    });

    return this.formatRow(row);
  }

  async listForEntity(
    userKey: string,
    entityType: SignatureTarget,
    entityId: string,
  ) {
    const { projectId } = await this.resolveEntityScope(entityType, entityId);
    await this.projectsService.ensureReportProjectAccess(projectId, userKey);

    const rows = await this.prisma.digitalSignature.findMany({
      where: { entityType, entityId },
      orderBy: { signedAt: 'asc' },
    });

    return rows.map((r) => this.formatRow(r));
  }

  private formatRow(row: {
    id: string;
    signatureData: string;
    signerName: string;
    signerId: string | null;
    signerRole: string;
    entityType: SignatureTarget;
    entityId: string;
    ipAddress: string | null;
    signedAt: Date;
  }) {
    return {
      id: row.id,
      signatureData: row.signatureData,
      signerName: row.signerName,
      signerId: row.signerId,
      signerRole: row.signerRole,
      entityType: row.entityType,
      entityId: row.entityId,
      ipAddress: row.ipAddress,
      signedAt: row.signedAt.toISOString(),
    };
  }
}
