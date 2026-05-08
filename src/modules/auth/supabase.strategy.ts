import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { PrismaService } from '../../prisma/prisma.service';

interface SupabaseJwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy, 'supabase') {
  constructor(private prisma: PrismaService) {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) throw new Error('SUPABASE_URL não definido no .env');
    const localJwtSecret = process.env.SUPABASE_JWT_SECRET;
    const jwksProvider = passportJwtSecret({
      jwksUri: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
      cache: true,
      rateLimit: true,
    });

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Em dev local pode aparecer HS256; em cloud/local recente, ES/RS via JWKS.
      secretOrKeyProvider: (req, rawJwtToken, done) => {
        const alg = this.readJwtAlg(rawJwtToken);
        if (alg === 'HS256' && localJwtSecret) {
          done(null, localJwtSecret);
          return;
        }
        jwksProvider(req, rawJwtToken, done);
      },
      algorithms: ['HS256', 'ES256', 'RS256'],
    });
  }

  private readJwtAlg(rawJwtToken: string): string | null {
    try {
      const [headerB64] = rawJwtToken.split('.');
      if (!headerB64) return null;
      const normalized = headerB64.replace(/-/g, '+').replace(/_/g, '/');
      const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
      const json = Buffer.from(normalized + pad, 'base64').toString('utf8');
      const header = JSON.parse(json) as { alg?: string };
      return header.alg ?? null;
    } catch {
      return null;
    }
  }

  async validate(payload: SupabaseJwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { authId: payload.sub },
      include: { worker: true },
    });

    // Retorna payload mínimo quando o perfil ainda não existe — permite POST /auth/sync funcionar
    if (!user) {
      return { authId: payload.sub, email: payload.email, _unsynced: true };
    }

    return user;
  }
}
