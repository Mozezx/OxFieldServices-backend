/**
 * Insere categorias e ferramentas de exemplo (idempotente) para checkout no app worker.
 *
 * As imagens ilustrativas devem ser carregadas para o Supabase com:
 *   node scripts/upload-tool-seed-images.mjs
 *
 * Uso (na pasta ox-backend):
 *   node scripts/seed-tools.mjs
 *   # ou: npx prisma db seed
 *
 * Requer DATABASE_URL no .env (mesmo do Prisma).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { CAT, TOOL_SEED } from './lib/tool-seed-data.mjs';

const prisma = new PrismaClient();

async function main() {
  const categories = [
    { id: CAT.MEDICAO, name: 'Medição e nível' },
    { id: CAT.CORTE, name: 'Corte e fixação' },
    { id: CAT.ELETRICA, name: 'Eletricidade e diagnóstico' },
    { id: CAT.EPI, name: 'Proteção individual (EPI)' },
    { id: CAT.ELEVACAO, name: 'Elevação e transporte' },
  ];

  for (const c of categories) {
    await prisma.toolCategory.upsert({
      where: { id: c.id },
      create: { id: c.id, name: c.name },
      update: { name: c.name },
    });
  }

  for (const t of TOOL_SEED) {
    await prisma.tool.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        name: t.name,
        categoryId: t.categoryId,
        imageUrl: null,
      },
      update: {
        name: t.name,
        categoryId: t.categoryId,
      },
    });
  }

  console.log(
    `Seed de ferramentas: ${categories.length} categorias, ${TOOL_SEED.length} ferramentas (upsert concluído).`,
  );
  console.log(
    'Para preencher imagens no Supabase Storage: node scripts/upload-tool-seed-images.mjs',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
