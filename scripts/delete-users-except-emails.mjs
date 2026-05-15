/**
 * Apaga todos os utilizadores exceto os emails indicados.
 * Remove antes todos os projetos (fluxo igual a delete-all-projects.mjs),
 * crews criados por quem sai, ratings, tool checkouts e workers associados.
 *
 * Uso (em ox-backend):
 *   npx dotenv -e .env -- node scripts/delete-users-except-emails.mjs
 */
import 'dotenv/config';
import { PrismaClient, SignatureTarget } from '@prisma/client';

const prisma = new PrismaClient();

const KEEP_EMAILS = [
  'oxtelec@gmail.com',
  'oxdesigner@hotmail.com',
  'oxsgalicia@gmail.com',
];

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
async function deleteAllProjectsInTx(tx) {
  const projects = await tx.project.findMany({ select: { id: true } });
  if (projects.length === 0) return 0;
  const projectIds = projects.map((p) => p.id);

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

  const { count } = await tx.project.deleteMany({
    where: { id: { in: projectIds } },
  });
  return count;
}

async function main() {
  const kept = await prisma.user.findMany({
    where: { email: { in: KEEP_EMAILS } },
    select: { id: true, email: true },
  });

  if (kept.length === 0) {
    console.error(
      'Abortado: nenhum dos emails indicados existe em public."User". Nada foi alterado.',
    );
    process.exit(1);
  }

  const keptIds = new Set(kept.map((u) => u.id));
  const missing = KEEP_EMAILS.filter((e) => !kept.some((u) => u.email === e));
  if (missing.length) {
    console.warn(`Aviso: estes emails não existem na base (são ignorados): ${missing.join(', ')}`);
  }

  const toDeleteCount = await prisma.user.count({
    where: { id: { notIn: [...keptIds] } },
  });
  if (toDeleteCount === 0) {
    console.log(`Já só existem os ${kept.length} utilizador(es) a manter. Nada a apagar.`);
    return;
  }

  console.log(
    `A manter ${kept.length} conta(s): ${kept.map((u) => u.email).join(', ')}. A remover ${toDeleteCount} outro(s)...`,
  );

  const toDeleteUserIds = (
    await prisma.user.findMany({
      where: { id: { notIn: [...keptIds] } },
      select: { id: true },
    })
  ).map((r) => r.id);

  await prisma.$transaction(
    async (tx) => {
      const nProj = await deleteAllProjectsInTx(tx);
      if (nProj) console.log(`  Removidos ${nProj} projeto(s).`);

      await tx.workerRating.deleteMany();

      await tx.crew.deleteMany({
        where: { createdBy: { in: toDeleteUserIds } },
      });

      const workerRows = await tx.worker.findMany({
        where: { userId: { in: toDeleteUserIds } },
        select: { id: true },
      });
      const workerIds = workerRows.map((w) => w.id);

      if (workerIds.length) {
        await tx.toolCheckout.deleteMany({
          where: { workerId: { in: workerIds } },
        });
      }

      const delWorkers = await tx.worker.deleteMany({
        where: { userId: { in: toDeleteUserIds } },
      });
      console.log(`  Removidos ${delWorkers.count} worker(s).`);

      const delUsers = await tx.user.deleteMany({
        where: { id: { in: toDeleteUserIds } },
      });
      console.log(`  Removidos ${delUsers.count} utilizador(es).`);
    },
    { timeout: 300_000 },
  );

  try {
    const r = await prisma.$executeRaw`
      DELETE FROM auth.users a
      WHERE NOT EXISTS (
        SELECT 1 FROM public."User" u WHERE u."authId" = a.id::text
      )
    `;
    console.log(`auth.users: linhas afetadas (delete): ${r}`);
  } catch (e) {
    console.warn(
      'Aviso: não foi possível limpar auth.users (sem permissão ou schema auth inexistente).',
    );
    console.warn(e.message);
  }

  const finalCount = await prisma.user.count();
  console.log(`Concluído. Utilizadores em public."User": ${finalCount}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
