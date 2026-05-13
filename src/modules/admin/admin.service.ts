import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupOrCreateClientDto } from './dto/lookup-or-create-client.dto';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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
   * Cria utilizador worker com authId `pending:<uuid>` e registo Worker (mesmo padrão que cliente stub).
   */
  async createWorker(dto: CreateWorkerDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Este e-mail já está em uso');
    }

    const skills = (dto.skills ?? []).map((s) => s.trim()).filter(Boolean);

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || undefined,
        role: 'worker',
        authId: `pending:${randomUUID()}`,
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
  }

  /**
   * Remove worker e utilizador associado, após limpar dependências na BD.
   */
  async deleteWorker(workerId: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      include: { user: { select: { id: true, role: true } } },
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

    return { deleted: true as const };
  }
}
