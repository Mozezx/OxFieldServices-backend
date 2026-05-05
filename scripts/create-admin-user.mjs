/**
 * Cria (ou atualiza) um utilizador Supabase Auth e o perfil em public."User" com role admin.
 *
 * Uso (na pasta ox-backend):
 *   node scripts/create-admin-user.mjs <email> <password> [nome]
 *
 * Requer no .env: SUPABASE_URL, SUPABASE_SERVICE_KEY (ou SUPABASE_SERVICE_ROLE_KEY),
 * e DATABASE_URL para o Prisma.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function requireEnv(name, ...aliases) {
  const v = process.env[name] ?? aliases.map((a) => process.env[a]).find(Boolean);
  if (!v) throw new Error(`Variável de ambiente em falta: ${name}`);
  return v;
}

async function authUserIdByEmail(email) {
  const rows = await prisma.$queryRaw`SELECT id::text AS id FROM auth.users WHERE email = ${email} LIMIT 1`;
  return rows[0]?.id ?? null;
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  const name = process.argv[4]?.trim() || email.split('@')[0];

  if (!email?.includes('@') || !password) {
    console.error('Uso: node scripts/create-admin-user.mjs <email> <password> [nome]');
    process.exit(1);
  }

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let authId = await authUserIdByEmail(email);

  if (!authId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    authId = data.user.id;
    console.log('auth.users: utilizador criado.');
  } else {
    const { error } = await supabase.auth.admin.updateUserById(authId, {
      password,
      email_confirm: true,
    });
    if (error) throw error;
    console.log('auth.users: utilizador já existia — palavra-passe e email atualizados.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: {
        authId,
        role: 'admin',
        name: name.length >= 2 ? name : existing.name,
      },
    });
    console.log(`public."User": atualizado para admin (id=${existing.id}).`);
  } else {
    const created = await prisma.user.create({
      data: {
        authId,
        email,
        name: name.length >= 2 ? name : email.split('@')[0],
        role: 'admin',
      },
    });
    console.log(`public."User": criado com role admin (id=${created.id}).`);
  }

  console.log('Concluído. Pode iniciar sessão no painel admin com este email.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
