import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGalleryLinkDto } from './dto/create-gallery-link.dto';

@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  private galleryPublicUrl(token: string): string {
    const base =
      process.env.GALLERY_PUBLIC_BASE_URL ??
      process.env.APP_BASE_URL ??
      process.env.APP_URL ??
      'http://localhost:3001';
    const trimmed = base.replace(/\/$/, '');
    return `${trimmed}/gallery/${token}`;
  }

  async createLink(projectId: string, userKey: string, dto: CreateGalleryLinkDto) {
    const { userId } = await this.projectsService.ensureGalleryManageAccess(
      projectId,
      userKey,
    );

    const expiresAt =
      dto.expiresAt !== undefined && dto.expiresAt !== ''
        ? new Date(dto.expiresAt)
        : null;

    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Data de expiração inválida.');
    }

    const row = await this.prisma.projectGalleryLink.create({
      data: {
        projectId,
        createdBy: userId,
        expiresAt,
      },
      select: {
        id: true,
        token: true,
        expiresAt: true,
        createdAt: true,
        isActive: true,
      },
    });

    return {
      id: row.id,
      token: row.token,
      url: this.galleryPublicUrl(row.token),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      isActive: row.isActive,
    };
  }

  async revokeLink(linkId: string, userKey: string) {
    const link = await this.prisma.projectGalleryLink.findUnique({
      where: { id: linkId },
      select: { id: true, projectId: true },
    });

    if (!link) {
      throw new NotFoundException('Link não encontrado');
    }

    await this.projectsService.ensureGalleryManageAccess(link.projectId, userKey);

    await this.prisma.projectGalleryLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });

    return { ok: true as const };
  }

  async listLinks(projectId: string, userKey: string) {
    await this.projectsService.ensureGalleryManageAccess(projectId, userKey);

    const rows = await this.prisma.projectGalleryLink.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => {
      const expired =
        row.expiresAt !== null && row.expiresAt.getTime() < Date.now();
      let status: 'active' | 'revoked' | 'expired';
      if (!row.isActive) {
        status = 'revoked';
      } else if (expired) {
        status = 'expired';
      } else {
        status = 'active';
      }

      return {
        id: row.id,
        token: row.token,
        url: this.galleryPublicUrl(row.token),
        views: row.viewCount,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        status,
      };
    });
  }

  async getPublicByToken(token: string) {
    const link = await this.prisma.projectGalleryLink.findUnique({
      where: { token },
      include: {
        project: {
          select: {
            title: true,
            organization: {
              select: { name: true, logoUrl: true },
            },
            phases: {
              where: { status: 'completed' },
              orderBy: { order: 'asc' },
              select: {
                id: true,
                name: true,
                order: true,
                status: true,
                evidences: {
                  orderBy: { uploadedAt: 'asc' },
                  select: {
                    id: true,
                    type: true,
                    url: true,
                    uploadedAt: true,
                    latitude: true,
                    longitude: true,
                    annotationData: true,
                    aiCaption: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!link || !link.isActive) {
      throw new NotFoundException('Link inválido ou expirado');
    }

    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException('Link inválido ou expirado');
    }

    await this.prisma.projectGalleryLink.update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 } },
    });

    const org = link.project.organization;

    return {
      project: {
        title: link.project.title,
      },
      organization: org
        ? {
            name: org.name,
            logoUrl: org.logoUrl,
          }
        : null,
      phases: link.project.phases.map((p) => ({
        id: p.id,
        name: p.name,
        order: p.order,
        status: p.status,
        evidences: p.evidences.map((e) => ({
          id: e.id,
          type: e.type,
          url: e.url,
          uploadedAt: e.uploadedAt.toISOString(),
          latitude: e.latitude,
          longitude: e.longitude,
          annotationData: e.annotationData,
          aiCaption: e.aiCaption,
        })),
      })),
    };
  }
}
