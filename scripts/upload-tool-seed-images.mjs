/**
 * Descarrega as imagens de exemplo (Commons / Unsplash) e envia-as para o bucket
 * Supabase `tool-images`, atualizando `Tool.imageUrl` com a URL pública.
 *
 * Requer no .env (ox-backend): DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY (ou SUPABASE_SERVICE_ROLE_KEY)
 *
 * Uso: node scripts/upload-tool-seed-images.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import { TOOL_SEED } from './lib/tool-seed-data.mjs';

const prisma = new PrismaClient();

function requireEnv(name, ...aliases) {
  const v = process.env[name] ?? aliases.map((a) => process.env[a]).find(Boolean);
  if (!v) throw new Error(`Variável de ambiente em falta: ${name}`);
  return v;
}

const FETCH_HEADERS = {
  'User-Agent': 'OXFieldServices/1.0 (seed upload; contact: admin)',
  Accept: 'image/*,*/*',
};

function extFromContentType(ct, fallbackPath) {
  const m = String(ct || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  const seg = fallbackPath.split('.').pop()?.toLowerCase();
  if (seg && ['jpg', 'jpeg', 'png', 'webp'].includes(seg)) return seg === 'jpeg' ? 'jpg' : seg;
  return 'jpg';
}

function contentTypeForExt(ext) {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, serviceKey);

  let ok = 0;
  let fail = 0;

  for (const t of TOOL_SEED) {
    const path = `tools/${t.id}/seed-cover`;
    try {
      const res = await fetch(t.sourceImageUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ao descarregar`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 256) throw new Error(`ficheiro demasiado pequeno (${buf.length} bytes)`);
      if (buf.length > 5 * 1024 * 1024) throw new Error('imagem > 5 MB');

      const ext = extFromContentType(res.headers.get('content-type'), new URL(t.sourceImageUrl).pathname);
      const storagePath = `${path}.${ext}`;
      const ct = contentTypeForExt(ext);

      const { error: upErr } = await supabase.storage
        .from('tool-images')
        .upload(storagePath, buf, { contentType: ct, upsert: true });

      if (upErr) throw new Error(upErr.message);

      const {
        data: { publicUrl },
      } = supabase.storage.from('tool-images').getPublicUrl(storagePath);

      await prisma.tool.update({
        where: { id: t.id },
        data: { imageUrl: publicUrl },
      });

      console.log(`OK ${t.name} → ${publicUrl}`);
      ok += 1;
    } catch (e) {
      console.error(`FALHA ${t.name} (${t.id}):`, e instanceof Error ? e.message : e);
      fail += 1;
    }
  }

  console.log(`\nConcluído: ${ok} enviados, ${fail} falhados.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
