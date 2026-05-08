import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePhaseTemplateDto,
  CreateTemplateDto,
} from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve userId interno a partir de id Prisma ou authId Supabase. */
  private async resolveUserId(userKey: string): Promise<string> {
    const key = userKey?.trim();
    if (!key) {
      throw new ForbiddenException('Sessão inválida.');
    }
    const u = await this.prisma.user.findFirst({
      where: { OR: [{ id: key }, { authId: key }] },
      select: { id: true },
    });
    if (!u) throw new ForbiddenException('Utilizador não encontrado.');
    return u.id;
  }

  /** Todas as orgs de que o user é membro. */
  async getUserOrganizationIds(userId: string): Promise<string[]> {
    const ms = await this.prisma.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    return ms.map((m) => m.organizationId);
  }

  /** Org de admin para escrita (primeira por joinedAt). */
  async getAdminOrganizationIdForWrite(userId: string): Promise<string> {
    const m = await this.prisma.organizationMember.findFirst({
      where: { userId, role: 'admin' },
      orderBy: { joinedAt: 'asc' },
      select: { organizationId: true },
    });
    if (!m) {
      throw new ForbiddenException(
        'Utilizador não pertence a nenhuma organização como admin.',
      );
    }
    return m.organizationId;
  }

  async findAllForUser(
    userKey: string,
    opts?: { includeInactive?: boolean },
  ) {
    const userId = await this.resolveUserId(userKey);
    const orgIds = await this.getUserOrganizationIds(userId);
    if (orgIds.length === 0) return [];

    return this.prisma.projectTemplate.findMany({
      where: {
        organizationId: { in: orgIds },
        ...(opts?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        phaseTemplates: { orderBy: { order: 'asc' } },
      },
    });
  }

  async findOneForUser(userKey: string, id: string) {
    const userId = await this.resolveUserId(userKey);
    const orgIds = await this.getUserOrganizationIds(userId);
    const template = await this.prisma.projectTemplate.findUnique({
      where: { id },
      include: { phaseTemplates: { orderBy: { order: 'asc' } } },
    });
    if (!template || !orgIds.includes(template.organizationId)) {
      throw new NotFoundException('Template não encontrado');
    }
    return template;
  }

  async create(userKey: string, dto: CreateTemplateDto) {
    const userId = await this.resolveUserId(userKey);
    const organizationId = await this.getAdminOrganizationIdForWrite(userId);

    return this.prisma.projectTemplate.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description ?? null,
        category: dto.category ?? null,
        createdBy: userId,
        phaseTemplates: {
          create: (dto.phases ?? []).map((p) => this.toPhaseTemplateCreate(p)),
        },
      },
      include: { phaseTemplates: { orderBy: { order: 'asc' } } },
    });
  }

  async update(userKey: string, id: string, dto: UpdateTemplateDto) {
    const userId = await this.resolveUserId(userKey);
    const orgIds = await this.getUserOrganizationIds(userId);

    const existing = await this.prisma.projectTemplate.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!existing || !orgIds.includes(existing.organizationId)) {
      throw new NotFoundException('Template não encontrado');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.projectTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
        },
      });

      if (dto.phases) {
        await tx.phaseTemplate.deleteMany({ where: { templateId: id } });
        for (const p of dto.phases) {
          await tx.phaseTemplate.create({
            data: { templateId: id, ...this.toPhaseTemplateCreate(p) },
          });
        }
      }

      return tx.projectTemplate.findUniqueOrThrow({
        where: { id },
        include: { phaseTemplates: { orderBy: { order: 'asc' } } },
      });
    });
  }

  async softDelete(userKey: string, id: string) {
    const userId = await this.resolveUserId(userKey);
    const orgIds = await this.getUserOrganizationIds(userId);
    const existing = await this.prisma.projectTemplate.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!existing || !orgIds.includes(existing.organizationId)) {
      throw new NotFoundException('Template não encontrado');
    }

    await this.prisma.projectTemplate.update({
      where: { id },
      data: { isActive: false },
    });
    return { ok: true as const };
  }

  /**
   * Garante que o template existe e pertence a uma das orgs do user.
   * Retorna o template + organizationId para uso no fluxo de criação de projeto.
   */
  async assertTemplateAccessible(userId: string, templateId: string) {
    const orgIds = await this.getUserOrganizationIds(userId);
    const template = await this.prisma.projectTemplate.findUnique({
      where: { id: templateId },
      include: { phaseTemplates: { orderBy: { order: 'asc' } } },
    });
    if (!template || !template.isActive || !orgIds.includes(template.organizationId)) {
      throw new NotFoundException('Template não encontrado para esta organização');
    }
    return template;
  }

  private toPhaseTemplateCreate(p: CreatePhaseTemplateDto) {
    const checklist = p.checklist
      ? (p.checklist.map((c, idx) => ({
          label: c.label,
          requiresPhoto: Boolean(c.requiresPhoto),
          order: c.order ?? idx + 1,
        })) as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;
    return {
      name: p.name,
      order: p.order,
      description: p.description ?? null,
      checklist,
    };
  }
}
