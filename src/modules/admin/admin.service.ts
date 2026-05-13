import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupOrCreateClientDto } from './dto/lookup-or-create-client.dto';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private getSupabaseAdmin(): SupabaseClient {
    const url = this.config.get<string>('SUPABASE_URL');
    const key =
      this.config.get<string>('SUPABASE_SERVICE_KEY') ??
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      throw new InternalServerErrorException(
        'SUPABASE_URL e SUPABASE_SERVICE_KEY (ou SUPABASE_SERVICE_ROLE_KEY) são obrigatórios para criar workers com login.',
      );
    }
    return createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /**
   * Busca cliente por email; se não existir, cria um stub com authId "pending:<uuid>".
   * O authId real é preenchido na primeira chamada POST /auth/sync do cliente.
   */
  async lookupOrCreateClient(dto: LookupOrCreateClientDto) {
    if (dto.unregistered || !dto.email) {
      const uuid = randomUUID();
      const created = await this.prisma.user.create({
        data: {
          email: `unregistered_${uuid}@placeholder.ox`,
          name: dto.name ?? 'Cliente não cadastrado',
          phone: dto.phone,
          role: 'client',
          authId: `pending:${uuid}`,
        },
        select: { id: true, name: true, email: true, phone: true, role: true, authId: true },
      });
      return { ...created, isNew: true, unregistered: true };
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, name: true, email: true, phone: true, role: true, authId: true },
    });

    if (existing) {
      return { ...existing, isNew: false };
    }

    const created = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name ?? dto.email.split('@')[0],
        phone: dto.phone,
        role: 'client',
        authId: `pending:${randomUUID()}`,
      },
      select: { id: true, name: true, email: true, phone: true, role: true, authId: true },
    });

    return { ...created, isNew: true };
  }

  /**
   * Cria utilizador em Supabase Auth (e-mail + palavra-passe confirmada) e perfil
   * `User` + `Worker` na API com o mesmo `authId` (sub JWT).
   */
  async createWorker(dto: CreateWorkerDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Este e-mail já está em uso na plataforma');
    }

    const supabase = this.getSupabaseAdmin();
    const displayName = dto.name.trim();
    const password = dto.password.trim();

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });

    if (authError || !authData.user) {
      const msg = authError?.message ?? 'Falha ao criar utilizador no Supabase';
      if (/already|registered|exists|duplicate/i.test(msg)) {
        throw new ConflictException(
          'Este e-mail já está registado no Supabase. Use outro e-mail ou remova a conta em Authentication.',
        );
      }
      throw new BadRequestException(msg);
    }

    const authId = authData.user.id;
    const skills = (dto.skills ?? []).map((s) => s.trim()).filter(Boolean);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          name: displayName,
          phone: dto.phone?.trim() || undefined,
          role: 'worker',
          authId,
          worker: {
            create: {
              skills,
              available: true,
              accessTier: 'standard',
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          authId: true,
          worker: {
            select: {
              id: true,
              skills: true,
              rating: true,
              shelterCertified: true,
              available: true,
              accessTier: true,
            },
          },
        },
      });

      if (!user.worker) {
        throw new ConflictException('Falha ao criar perfil de worker');
      }

      return { user, worker: user.worker, isNew: true as const };
    } catch (err) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(authId);
      if (delErr) {
        this.logger.error(
          `Revert Supabase user falhou após erro Prisma (authId=${authId}): ${delErr.message}`,
        );
      }
      throw err;
    }
  }

  /**
   * Remove worker e utilizador associado, após limpar dependências na BD.
   */
  async deleteWorker(workerId: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      include: { user: { select: { id: true, role: true, authId: true } } },
    });
    if (!worker) {
      throw new NotFoundException('Worker não encontrado');
    }
    if (worker.user.role !== 'worker') {
      throw new ConflictException(
        'Apenas contas com papel worker podem ser removidas por este endpoint',
      );
    }

    const userId = worker.userId;
    const clientProjects = await this.prisma.project.count({
      where: { clientId: userId },
    });
    if (clientProjects > 0) {
      throw new ConflictException(
        'Este utilizador é cliente em um ou mais projetos; não é possível eliminar por aqui.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const contracts = await tx.contract.findMany({
        where: { workerId },
        select: { id: true },
      });
      const contractIds = contracts.map((c) => c.id);

      if (contractIds.length) {
        const escrows = await tx.escrowTxn.findMany({
          where: { contractId: { in: contractIds } },
          select: { id: true },
        });
        const escrowIds = escrows.map((e) => e.id);
        if (escrowIds.length) {
          await tx.payment.deleteMany({ where: { escrowId: { in: escrowIds } } });
          await tx.escrowTxn.deleteMany({ where: { id: { in: escrowIds } } });
        }
        await tx.contract.deleteMany({ where: { id: { in: contractIds } } });
      }

      await tx.toolCheckout.deleteMany({ where: { workerId } });
      await tx.workerRating.deleteMany({
        where: { OR: [{ workerId }, { userId }] },
      });
      await tx.projectAssignment.deleteMany({
        where: { OR: [{ workerId }, { assignedBy: userId }] },
      });
      await tx.crewMember.deleteMany({ where: { workerId } });
      await tx.crew.deleteMany({ where: { createdBy: userId } });
      await tx.projectInvite.deleteMany({ where: { clientId: userId } });

      const phaseEvidenceIds = (
        await tx.phaseEvidence.findMany({
          where: { uploadedBy: userId },
          select: { id: true },
        })
      ).map((e) => e.id);
      if (phaseEvidenceIds.length) {
        await tx.evidenceComment.deleteMany({
          where: { evidenceId: { in: phaseEvidenceIds } },
        });
      }
      await tx.evidenceComment.deleteMany({ where: { authorId: userId } });
      await tx.phaseEvidence.deleteMany({ where: { uploadedBy: userId } });

      const projectEvidenceIds = (
        await tx.projectEvidence.findMany({
          where: { uploadedBy: userId },
          select: { id: true },
        })
      ).map((e) => e.id);
      if (projectEvidenceIds.length) {
        await tx.projectEvidenceComment.deleteMany({
          where: { evidenceId: { in: projectEvidenceIds } },
        });
      }
      await tx.projectEvidenceComment.deleteMany({ where: { authorId: userId } });
      await tx.projectEvidence.deleteMany({ where: { uploadedBy: userId } });

      await tx.workerLocation.deleteMany({ where: { workerId } });
      await tx.worker.delete({ where: { id: workerId } });
      await tx.user.delete({ where: { id: userId } });
    });

    const authId = worker.user.authId;
    if (authId && !authId.startsWith('pending:')) {
      try {
        const supabase = this.getSupabaseAdmin();
        const { error } = await supabase.auth.admin.deleteUser(authId);
        if (error) {
          this.logger.warn(
            `Supabase Auth: não foi possível remover utilizador ${authId}: ${error.message}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `Supabase Auth: falha ao remover utilizador ${authId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return { deleted: true as const };
  }
}
