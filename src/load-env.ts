import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Carrega `.env` e depois `.env.local` com override.
 * Deve ser importado antes de qualquer outro módulo da app (ver `main.ts`).
 *
 * Motivo: o `ConfigModule` do Nest faz merge final com `process.env` por cima dos
 * ficheiros — se `SUPABASE_URL` (ou JWT secret) vier do ambiente/IDE a apontar
 * para outro projeto, o JWKS fica errado e tokens ES256 locais falham com 401.
 */
const root = process.cwd();
const envPath = resolve(root, '.env');
const localPath = resolve(root, '.env.local');

if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}
if (existsSync(localPath)) {
  dotenvConfig({ path: localPath, override: true });
}
