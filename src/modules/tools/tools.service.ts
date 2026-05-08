import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { ToolCheckoutStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateToolDto } from './dto/create-tool.dto';
import { UpdateToolDto } from './dto/update-tool.dto';

const TOOL_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_TOOL_IMAGE_BYTES = 5 * 1024 * 1024;

/** Checkout ainda “fora do armazém”: com o worker ou aguardando confirmação de devolução. */
const ACTIVE_TOOL_CHECKOUT_STATUSES: ToolCheckoutStatus[] = [
  ToolCheckoutStatus.CHECKED_OUT,
  ToolCheckoutStatus.RETURN_PENDING,
];

const toolListInclude = {
  category: true,
  checkouts: {
    where: {
      status: { in: ACTIVE_TOOL_CHECKOUT_STATUSES },
    },
    orderBy: { checkedOutAt: 'desc' as const },
    take: 1,
    include: {
      worker: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  },
};

@Injectable()
export class ToolsService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  constructor(private prisma: PrismaService) {}

  // ─── Categories ─────────────────────────────────────────

  findCategories() {
    return this.prisma.toolCategory.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(dto: CreateCategoryDto) {
    return this.prisma.toolCategory.create({
      data: { name: dto.name.trim() },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    await this.ensureCategory(id);
    return this.prisma.toolCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      },
    });
  }

  async removeCategory(id: string) {
    await this.ensureCategory(id);
    const count = await this.prisma.tool.count({ where: { categoryId: id } });
    if (count > 0) {
      throw new ConflictException(
        'Não é possível excluir a categoria enquanto houver ferramentas associadas.',
      );
    }
    await this.prisma.toolCategory.delete({ where: { id } });
  }

  // ─── Tools ──────────────────────────────────────────────

  async findTools(categoryId?: string) {
    const where = categoryId ? { categoryId } : {};
    return this.prisma.tool.findMany({
      where,
      orderBy: { name: 'asc' },
      include: toolListInclude,
    });
  }

  async findOneTool(id: string) {
    const tool = await this.prisma.tool.findUnique({
      where: { id },
      include: toolListInclude,
    });
    if (!tool) throw new NotFoundException('Ferramenta não encontrada');
    return tool;
  }

  async createTool(dto: CreateToolDto, file?: Express.Multer.File) {
    await this.ensureCategory(dto.categoryId);
    if (file) this.assertToolImage(file);

    const tool = await this.prisma.tool.create({
      data: {
        name: dto.name.trim(),
        categoryId: dto.categoryId,
      },
    });

    if (file) {
      const url = await this.uploadToolImage(tool.id, file);
      return this.prisma.tool.update({
        where: { id: tool.id },
        data: { imageUrl: url },
        include: toolListInclude,
      });
    }

    return this.prisma.tool.findUniqueOrThrow({
      where: { id: tool.id },
      include: toolListInclude,
    });
  }

  async updateTool(id: string, dto: UpdateToolDto, file?: Express.Multer.File) {
    const existing = await this.prisma.tool.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ferramenta não encontrada');

    if (dto.categoryId) await this.ensureCategory(dto.categoryId);
    if (file) this.assertToolImage(file);

    const hasMeta =
      dto.name !== undefined || dto.categoryId !== undefined;
    if (!file && !hasMeta) {
      throw new BadRequestException('Informe campos ou imagem para atualizar.');
    }

    let imageUrl = existing.imageUrl;
    if (file) {
      if (existing.imageUrl) await this.removeToolImageFromStorage(existing.imageUrl);
      imageUrl = await this.uploadToolImage(id, file);
    }

    return this.prisma.tool.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(file ? { imageUrl } : {}),
      },
      include: toolListInclude,
    });
  }

  async removeTool(id: string) {
    const existing = await this.prisma.tool.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ferramenta não encontrada');

    const active = await this.prisma.toolCheckout.findFirst({
      where: { toolId: id, status: { in: ACTIVE_TOOL_CHECKOUT_STATUSES } },
    });
    if (active) {
      throw new ConflictException(
        'Não é possível excluir: existe checkout ativo para esta ferramenta.',
      );
    }

    if (existing.imageUrl) await this.removeToolImageFromStorage(existing.imageUrl);

    await this.prisma.tool.delete({ where: { id } });
  }

  // ─── Checkouts ─────────────────────────────────────────

  async listActiveCheckoutsForRole(userId: string, role: string) {
    if (role === 'admin') {
      return this.prisma.toolCheckout.findMany({
        where: { status: { in: ACTIVE_TOOL_CHECKOUT_STATUSES } },
        orderBy: { checkedOutAt: 'desc' },
        include: {
          tool: { include: { category: true } },
          worker: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
    }

    if (role === 'worker') {
      const worker = await this.prisma.worker.findUnique({ where: { userId } });
      if (!worker) throw new NotFoundException('Perfil de worker não encontrado');

      return this.prisma.toolCheckout.findMany({
        where: {
          workerId: worker.id,
          status: { in: ACTIVE_TOOL_CHECKOUT_STATUSES },
        },
        orderBy: { checkedOutAt: 'desc' },
        include: {
          tool: { include: { category: true } },
          worker: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
    }

    throw new BadRequestException('Papel não suportado para esta listagem.');
  }

  async checkoutHistoryForTool(toolId: string) {
    await this.ensureTool(toolId);
    return this.prisma.toolCheckout.findMany({
      where: { toolId },
      orderBy: { checkedOutAt: 'desc' },
      include: {
        worker: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  async checkoutTool(toolId: string, userId: string) {
    await this.ensureTool(toolId);

    const worker = await this.prisma.worker.findUnique({ where: { userId } });
    if (!worker) throw new NotFoundException('Perfil de worker não encontrado');

    const activeOnTool = await this.prisma.toolCheckout.findFirst({
      where: { toolId, status: { in: ACTIVE_TOOL_CHECKOUT_STATUSES } },
    });
    if (activeOnTool) {
      if (activeOnTool.workerId === worker.id) {
        if (activeOnTool.status === 'RETURN_PENDING') {
          throw new ConflictException(
            'Já solicitaste a devolução desta ferramenta. Aguarde a confirmação do administrador.',
          );
        }
        throw new ConflictException('Você já possui esta ferramenta em checkout.');
      }
      throw new ConflictException('Esta ferramenta já está em uso ou aguarda confirmação de devolução.');
    }

    return this.prisma.toolCheckout.create({
      data: {
        toolId,
        workerId: worker.id,
        status: 'CHECKED_OUT',
      },
      include: {
        tool: { include: { category: true } },
        worker: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  /** Worker: pedido de devolução (admin confirma a receção depois). Idempotente se já RETURN_PENDING. */
  async returnTool(toolId: string, userId: string) {
    const worker = await this.prisma.worker.findUnique({ where: { userId } });
    if (!worker) throw new NotFoundException('Perfil de worker não encontrado');

    const pending = await this.prisma.toolCheckout.findFirst({
      where: { toolId, workerId: worker.id, status: 'RETURN_PENDING' },
    });
    if (pending) {
      return this.prisma.toolCheckout.findUniqueOrThrow({
        where: { id: pending.id },
        include: {
          tool: { include: { category: true } },
          worker: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
    }

    const active = await this.prisma.toolCheckout.findFirst({
      where: { toolId, status: 'CHECKED_OUT', workerId: worker.id },
    });
    if (!active) {
      throw new BadRequestException(
        'Não há checkout ativo desta ferramenta em seu nome.',
      );
    }

    const now = new Date();
    return this.prisma.toolCheckout.update({
      where: { id: active.id },
      data: {
        status: 'RETURN_PENDING',
        returnRequestedAt: now,
      },
      include: {
        tool: { include: { category: true } },
        worker: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  /** Admin: confirma receção física após pedido do worker. */
  async confirmReturnCheckout(checkoutId: string) {
    const row = await this.prisma.toolCheckout.findUnique({
      where: { id: checkoutId },
    });
    if (!row) throw new NotFoundException('Checkout não encontrado');
    if (row.status !== 'RETURN_PENDING') {
      throw new BadRequestException(
        'Só é possível confirmar devoluções com pedido pendente (RETURN_PENDING).',
      );
    }

    return this.prisma.toolCheckout.update({
      where: { id: checkoutId },
      data: {
        status: 'RETURNED',
        returnedAt: new Date(),
      },
      include: {
        tool: { include: { category: true } },
        worker: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  /** Admin: encerra checkout sem fluxo normal (com worker ou já pendente). */
  async forceReturnCheckout(checkoutId: string) {
    const row = await this.prisma.toolCheckout.findUnique({
      where: { id: checkoutId },
    });
    if (!row) throw new NotFoundException('Checkout não encontrado');
    if (
      row.status !== 'CHECKED_OUT' &&
      row.status !== 'RETURN_PENDING'
    ) {
      throw new BadRequestException('Este checkout já foi encerrado.');
    }

    return this.prisma.toolCheckout.update({
      where: { id: checkoutId },
      data: {
        status: 'RETURNED',
        returnedAt: new Date(),
      },
      include: {
        tool: { include: { category: true } },
        worker: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  // ─── Helpers ────────────────────────────────────────────

  private async ensureCategory(id: string) {
    const c = await this.prisma.toolCategory.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Categoria não encontrada');
  }

  private async ensureTool(id: string) {
    const t = await this.prisma.tool.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Ferramenta não encontrada');
  }

  private assertToolImage(file: Express.Multer.File) {
    if (!TOOL_IMAGE_MIME.includes(file.mimetype as (typeof TOOL_IMAGE_MIME)[number])) {
      throw new BadRequestException(
        'Imagem inválida. Use JPEG, PNG ou WebP.',
      );
    }
    if (file.size > MAX_TOOL_IMAGE_BYTES) {
      throw new BadRequestException('Imagem excede 5 MB.');
    }
  }

  private async uploadToolImage(toolId: string, file: Express.Multer.File) {
    const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    const path = `tools/${toolId}/${Date.now()}.${safeExt}`;

    const { error } = await this.supabase.storage
      .from('tool-images')
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

    if (error) {
      throw new InternalServerErrorException(
        `Falha no upload da imagem: ${error.message}`,
      );
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from('tool-images').getPublicUrl(path);
    return publicUrl;
  }

  private async removeToolImageFromStorage(url: string) {
    const path = this.extractToolImagePath(url);
    if (!path) return;
    try {
      await this.supabase.storage.from('tool-images').remove([path]);
    } catch {
      // best-effort
    }
  }

  private extractToolImagePath(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.pathname.split('/object/public/tool-images/')[1] ?? null;
    } catch {
      return null;
    }
  }
}
