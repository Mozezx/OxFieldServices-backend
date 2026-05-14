import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type TokenCache = { accessToken: string; expiresAtMs: number };

/**
 * Bearer para a API TOConline:
 * - `TOCONLINE_ACCESS_TOKEN` (fixo, ex.: copiado do Postman após OAuth), ou
 * - `TOCONLINE_REFRESH_TOKEN` + `TOCONLINE_CLIENT_ID` + `TOCONLINE_CLIENT_SECRET`
 *   (renovação via POST `{oauth}/token` com grant_type=refresh_token).
 */
@Injectable()
export class ToconlineAuthService {
  private readonly logger = new Logger(ToconlineAuthService.name);
  private cache: TokenCache | null = null;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    const access = this.config.get<string>('TOCONLINE_ACCESS_TOKEN')?.trim();
    if (access) return true;
    const refresh = this.config.get<string>('TOCONLINE_REFRESH_TOKEN')?.trim();
    const id = this.config.get<string>('TOCONLINE_CLIENT_ID')?.trim();
    const secret = this.config.get<string>('TOCONLINE_CLIENT_SECRET')?.trim();
    return !!(refresh && id && secret);
  }

  async getAccessToken(): Promise<string> {
    const staticTok = this.config.get<string>('TOCONLINE_ACCESS_TOKEN')?.trim();
    if (staticTok) return staticTok;

    const refresh = this.config.get<string>('TOCONLINE_REFRESH_TOKEN')?.trim();
    const clientId = this.config.get<string>('TOCONLINE_CLIENT_ID')?.trim();
    const clientSecret = this.config.get<string>('TOCONLINE_CLIENT_SECRET')?.trim();
    const oauthBase = (
      this.config.get<string>('TOCONLINE_OAUTH_BASE_URL')?.trim() ??
      'https://app11.toconline.pt/oauth'
    ).replace(/\/$/, '');

    if (!refresh || !clientId || !clientSecret) {
      throw new Error(
        'TOConline: defina TOCONLINE_ACCESS_TOKEN ou TOCONLINE_REFRESH_TOKEN + TOCONLINE_CLIENT_ID + TOCONLINE_CLIENT_SECRET',
      );
    }

    const now = Date.now();
    if (this.cache && now < this.cache.expiresAtMs - 60_000) {
      return this.cache.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const res = await fetch(`${oauthBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      this.logger.error(
        `TOConline OAuth token: HTTP ${res.status} — ${text.slice(0, 500)}`,
      );
      throw new Error(
        `TOConline: falha ao renovar token (${res.status}). Confirme refresh_token e client_id/secret.`,
      );
    }

    const accessToken = parsed.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new Error('TOConline: resposta /token sem access_token');
    }

    const expiresIn = Number(parsed.expires_in ?? 3600);
    const ttlMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_600_000;

    this.cache = {
      accessToken,
      expiresAtMs: now + ttlMs,
    };

    const newRefresh = parsed.refresh_token;
    if (typeof newRefresh === 'string' && newRefresh && newRefresh !== refresh) {
      this.logger.warn(
        'TOConline devolveu refresh_token novo; atualize TOCONLINE_REFRESH_TOKEN no .env se a sessão expirar.',
      );
    }

    return accessToken;
  }
}
