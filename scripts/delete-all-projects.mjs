/**
 * Apaga todos os projetos (obras) e dados dependentes, mantendo utilizadores,
 * organizações, workers, templates de organização, etc.
 *
 * Uso (em ox-backend):
 *   npx dotenv -e .env.local -- node scripts/delete-all-projects.mjs
 * ou, se só tiveres `.env`:
 *   node scripts/delete-all-projects.mjs
 */
import 'dotenv/config';
import { PrismaClient, SignatureTarget } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, title: true } });
  if (projects.length === 0) {
    console.log('Nenhum projeto na base de dados.');
    return;
  }
  console.log(`A remover ${projects.length} projeto(s)...`);

  const projectIds = projects.map((p) => p.id);

  await prisma.$transaction(
    async (tx) => {
      const phaseRows = await tx.projectPhase.findMany({
        where: { projectId: { in: projectIds } },
        select: { id: true },
      });
      const phaseIds = phaseRows.map((r) => r.id);

      const reportRows = await tx.projectReport.findMany({
        where: { projectId: { in: projectIds } },
        select: { id: true },
      });
      const reportIds = reportRows.map((r) => r.id);

      const contractRows = await tx.contract.findMany({
        where: { projectId: { in: projectIds } },
        select: { id: true },
      });
      const contractIds = contractRows.map((r) => r.id);

      const sigOr = [];
      if (phaseIds.length) {
        sigOr.push({ entityType: SignatureTarget.PHASE_VALIDATION, entityId: { in: phaseIds } });
      }
      if (contractIds.length) {
        sigOr.push({ entityType: SignatureTarget.CONTRACT, entityId: { in: contractIds } });
      }
      if (reportIds.length) {
        sigOr.push({ entityType: SignatureTarget.PROJECT_REPORT, entityId: { in: reportIds } });
      }
      if (sigOr.length) {
        await tx.digitalSignature.deleteMany({ where: { OR: sigOr } });
      }

      await tx.payment.deleteMany({
        where: { escrow: { contract: { projectId: { in: projectIds } } } },
      });

      await tx.escrowTxn.deleteMany({
        where: { contract: { projectId: { in: projectIds } } },
      });

      await tx.contract.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      await tx.phaseEvidence.deleteMany({
        where: { phase: { projectId: { in: projectIds } } },
      });

      await tx.projectInvite.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      await tx.projectPhase.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      const deleted = await tx.project.deleteMany({
        where: { id: { in: projectIds } },
      });

      console.log(`Removidos ${deleted.count} projeto(s).`);
    },
    { timeout: 120_000 },
  );

  console.log('Concluído.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
