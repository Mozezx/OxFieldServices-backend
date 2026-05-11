import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../ai/ai.service';
import { ProcessCaptureDto } from './dto/process-capture.dto';

@Injectable()
export class CaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AIService,
  ) {}

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

  private async getAdminOrganizationIdForWrite(userId: string): Promise<string> {
    const m = await this.prisma.organizationMember.findFirst({
      where: { userId, role: 'admin' },
      orderBy: { joinedAt: 'asc' },
      select: { organizationId: true },
    });
    if (!m) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user?.role === 'admin') {
        const anyMembership = await this.prisma.organizationMember.findFirst({
          where: { userId },
          orderBy: { joinedAt: 'asc' },
          select: { organizationId: true },
        });
        if (anyMembership) {
          await this.prisma.organizationMember.update({
            where: {
              organizationId_userId: {
                organizationId: anyMembership.organizationId,
                userId,
              },
            },
            data: { role: 'admin' },
          });
          return anyMembership.organizationId;
        }

        const firstOrg = await this.prisma.organization.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        const organizationId =
          firstOrg?.id ??
          (
            await this.prisma.organization.create({
              data: {
                name: 'Default Organization',
                slug: `default-org-${randomUUID().slice(0, 8)}`,
              },
              select: { id: true },
            })
          ).id;

        await this.prisma.organizationMember.upsert({
          where: {
            organizationId_userId: {
              organizationId,
              userId,
            },
          },
          create: {
            organizationId,
            userId,
            role: 'admin',
          },
          update: {
            role: 'admin',
          },
        });
        return organizationId;
      }
      throw new ForbiddenException(
        'Utilizador não pertence a nenhuma organização como admin.',
      );
    }
    return m.organizationId;
  }

  async process(userKey: string, dto: ProcessCaptureDto) {
    const userId = await this.resolveUserId(userKey);
    const orgId = await this.getAdminOrganizationIdForWrite(userId);
    const raw = dto.text.trim();
    const extracted = await this.aiService.processCaptureText(raw);
    if (extracted.length === 0) {
      return { items: [] as Array<{ id: string; content: string; category: string }> };
    }

    const created = await this.prisma.$transaction(
      extracted.map((item) =>
        this.prisma.captureItem.create({
          data: {
            orgId,
            content: item.content,
            category: item.category,
            rawInput: raw,
          },
          select: { id: true, content: true, category: true },
        }),
      ),
    );

    return {
      items: created.map((row) => ({
        id: row.id,
        content: row.content,
        category: row.category,
      })),
    };
  }

  async recent(userKey: string) {
    const userId = await this.resolveUserId(userKey);
    const orgId = await this.getAdminOrganizationIdForWrite(userId);
    return this.prisma.captureItem.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, content: true, category: true, createdAt: true },
    });
  }

  async remove(userKey: string, id: string) {
    const userId = await this.resolveUserId(userKey);
    const orgId = await this.getAdminOrganizationIdForWrite(userId);
    const existing = await this.prisma.captureItem.findFirst({
      where: { id, orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Item não encontrado');
    await this.prisma.captureItem.delete({ where: { id } });
    return { ok: true };
  }
}
