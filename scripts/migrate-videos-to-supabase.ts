/**
 * Script one-shot para migrar vídeos do filesystem local para o Supabase Storage.
 *
 * Execução (a partir da raiz do ox-backend):
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-videos-to-supabase.ts
 *
 * Pré-requisitos:
 *   - Variáveis SUPABASE_URL e SUPABASE_SERVICE_KEY no .env
 *   - O servidor NestJS NÃO precisa estar rodando
 *   - Os arquivos de vídeo devem existir localmente em uploads/
 *
 * O script é idempotente: evidências que já apontam para Supabase são ignoradas.
 */

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, basename } from 'path';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import * as mime from 'mime-types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const prisma = new PrismaClient();

const SUPABASE_HOST = new URL(process.env.SUPABASE_URL!).hostname;

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host !== SUPABASE_HOST;
  } catch {
    return true;
  }
}

function localPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const marker = '/uploads/';
    const idx = parsed.pathname.indexOf(marker);
    if (idx === -1) return null;
    const rel = parsed.pathname.slice(idx + marker.length);
    return join(process.cwd(), 'uploads', rel);
  } catch {
    return null;
  }
}

async function uploadToSupabase(
  bucket: string,
  storagePath: string,
  localPath: string,
  mimeType: string,
): Promise<string> {
  const buffer = await readFile(localPath);

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true,
      cacheControl: 'public, max-age=31536000, immutable',
    });

  if (error) throw new Error(`Supabase upload error: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return publicUrl;
}

async function migratePhaseEvidences() {
  const evidences = await prisma.phaseEvidence.findMany({
    where: { url: { contains: '/uploads/' } },
    select: { id: true, url: true, type: true, phaseId: true },
  });

  console.log(`[PhaseEvidence] ${evidences.length} evidências locais encontradas.`);

  for (const ev of evidences) {
    if (!isLocalUrl(ev.url)) {
      console.log(`  SKIP ${ev.id} (já no Supabase)`);
      continue;
    }

    const localPath = localPathFromUrl(ev.url);
    if (!localPath || !existsSync(localPath)) {
      console.warn(`  WARN ${ev.id} arquivo não encontrado: ${localPath}`);
      continue;
    }

    const mimeType = ev.type || mime.lookup(localPath) || 'video/mp4';
    const ext = extname(localPath) || '.mp4';
    const storagePath = `phases/${ev.phaseId}/${Date.now()}-${basename(localPath, ext)}${ext}`;

    try {
      const newUrl = await uploadToSupabase('evidences', storagePath, localPath, mimeType);
      await prisma.phaseEvidence.update({ where: { id: ev.id }, data: { url: newUrl } });
      console.log(`  OK  ${ev.id} → ${newUrl}`);
    } catch (err) {
      console.error(`  ERR ${ev.id}:`, err);
    }
  }
}

async function migrateProjectEvidences() {
  const evidences = await prisma.projectEvidence.findMany({
    where: { url: { contains: '/uploads/' } },
    select: { id: true, url: true, type: true, projectId: true },
  });

  console.log(`[ProjectEvidence] ${evidences.length} evidências locais encontradas.`);

  for (const ev of evidences) {
    if (!isLocalUrl(ev.url)) {
      console.log(`  SKIP ${ev.id} (já no Supabase)`);
      continue;
    }

    const localPath = localPathFromUrl(ev.url);
    if (!localPath || !existsSync(localPath)) {
      console.warn(`  WARN ${ev.id} arquivo não encontrado: ${localPath}`);
      continue;
    }

    const mimeType = ev.type || mime.lookup(localPath) || 'video/mp4';
    const ext = extname(localPath) || '.mp4';
    const storagePath = `projects/${ev.projectId}/${Date.now()}-${basename(localPath, ext)}${ext}`;

    try {
      const newUrl = await uploadToSupabase('evidences', storagePath, localPath, mimeType);
      await prisma.projectEvidence.update({ where: { id: ev.id }, data: { url: newUrl } });
      console.log(`  OK  ${ev.id} → ${newUrl}`);
    } catch (err) {
      console.error(`  ERR ${ev.id}:`, err);
    }
  }
}

async function main() {
  console.log('=== Migração de vídeos locais → Supabase Storage ===\n');

  await migratePhaseEvidences();
  console.log();
  await migrateProjectEvidences();

  console.log('\n=== Concluído ===');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  prisma.$disconnect();
  process.exit(1);
});
