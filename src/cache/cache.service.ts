import { createHash } from 'crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const CACHE_PREFIX = 'ox:cache:';

/** Hash estável para segmentos de chave Redis (evita chaves gigantes). */
export function stableCacheSegment(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 32);
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis | null;

  constructor(private readonly config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.redis = null;
      this.logger.warn('REDIS_URL ausente — cache de aplicação desativado.');
      return;
    }
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.redis.on('error', (err: Error) =>
      this.logger.warn(`Redis cache: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }

  async cacheGet<T>(keySuffix: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
    const fullKey = `${CACHE_PREFIX}${keySuffix}`;
    if (!this.redis) {
      return fn();
    }
    try {
      const cached = await this.redis.get(fullKey);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch {
      // cache miss / parse error → DB
    }
    const data = await fn();
    try {
      await this.redis.setex(fullKey, ttlSec, JSON.stringify(data));
    } catch {
      // ignora falha de escrita
    }
    return data;
  }

  /** Remove todas as chaves `ox:cache:${prefix}*` (SCAN). */
  async invalidateByPrefix(prefix: string): Promise<void> {
    if (!this.redis) return;
    const pattern = `${CACHE_PREFIX}${prefix}*`;
    let cursor = '0';
    try {
      do {
        const [next, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          200,
        );
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn(`invalidateByPrefix(${prefix}): ${(err as Error).message}`);
    }
  }
}
