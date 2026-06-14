/* eslint-disable prettier/prettier */
import { Global, Module, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { UserStatusCacheService } from './user-status-cache.service.js';
import { REDIS_CLIENT } from './redis.constants.js';

const logger = new Logger('RedisModule');

/**
 * Resolve the ioredis connection URL.
 *
 * Upstash provides two env-var formats in their console:
 *   REST format  → UPSTASH_REDIS_REST_URL  + UPSTASH_REDIS_REST_TOKEN
 *   ioredis URL  → REDIS_URL (rediss://default:<token>@<host>:6380)
 *
 * If only the REST vars are present we construct the ioredis URL automatically.
 */
function resolveRedisUrl(): string {
  const direct = process.env.REDIS_URL;

  // Already a proper redis(s):// URL — use as-is
  if (direct && (direct.startsWith('redis://') || direct.startsWith('rediss://'))) {
    return direct;
  }

  // Upstash REST URL + token → build ioredis TLS URL
  const restUrl = process.env.UPSTASH_REDIS_REST_URL ?? direct; // fall back if user set REDIS_URL to the https:// value
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (restUrl && token) {
    const host = new URL(restUrl).hostname;
    return `rediss://default:${token}@${host}:6379`;
  }

  throw new Error(
    'Redis not configured. Set REDIS_URL (rediss://...) or both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
  );
}

function createRedisClient(): Redis {
  const url = resolveRedisUrl();

  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => {
      if (times > 5) {
        logger.error('Redis: max retries reached — giving up');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });

  client.on('connect', () => logger.log('Redis connected'));
  client.on('ready', () => logger.log('Redis ready'));
  client.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));
  client.on('close', () => logger.warn('Redis connection closed'));

  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: createRedisClient,
    },
    UserStatusCacheService,
  ],
  exports: [REDIS_CLIENT, UserStatusCacheService],
})
export class RedisModule {}
