/* eslint-disable prettier/prettier */
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

// Short TTL — the access token itself expires in 15m, so this only needs to
// bound how long a deactivated user keeps working before the cache catches up.
const TTL_SECONDS = 60;

function cacheKey(userId: string): string {
  return `auth:user-active:${userId}`;
}

/**
 * Caches the "user exists and is active" check performed on every
 * authenticated request (see JwtStrategy). Converts a Postgres round trip
 * into a Redis lookup for the common case.
 */
@Injectable()
export class UserStatusCacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async isActive(userId: string): Promise<boolean> {
    const cached = await this.redis.get(cacheKey(userId));
    return cached === '1';
  }

  async markActive(userId: string): Promise<void> {
    await this.redis.set(cacheKey(userId), '1', 'EX', TTL_SECONDS);
  }

  /** Drop the cached status — call when an admin bans/unbans a user. */
  async invalidate(userId: string): Promise<void> {
    await this.redis.del(cacheKey(userId));
  }
}
