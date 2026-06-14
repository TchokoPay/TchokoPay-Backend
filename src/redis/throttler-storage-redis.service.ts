/* eslint-disable prettier/prettier */
import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis, Result, ClientContext } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

export interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

declare module 'ioredis' {
  interface RedisCommander<Context extends ClientContext> {
    throttleIncrement(
      blockKey: string,
      countKey: string,
      ttl: string,
      limit: string,
      blockDurationMs: string,
    ): Result<[number, number, number, number], Context>;
  }
}

// Performs the block check, increment, TTL bookkeeping, and block-set in a
// single Redis round trip (atomically), instead of up to 4 sequential calls.
const THROTTLE_INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[1])
if blockTtl > 0 then
  return {tonumber(ARGV[2]) + 1, 0, 1, math.ceil(blockTtl / 1000)}
end

local totalHits = redis.call('INCR', KEYS[2])
local ttlMs = redis.call('PTTL', KEYS[2])

if ttlMs == -1 then
  redis.call('PEXPIRE', KEYS[2], ARGV[1])
  ttlMs = tonumber(ARGV[1])
end

local limit = tonumber(ARGV[2])
local blockDurationMs = tonumber(ARGV[3])
local isBlocked = 0
local timeToBlockExpire = 0

if totalHits > limit and blockDurationMs > 0 then
  redis.call('PSETEX', KEYS[1], blockDurationMs, '1')
  isBlocked = 1
  timeToBlockExpire = math.ceil(blockDurationMs / 1000)
end

return {totalHits, math.ceil(ttlMs / 1000), isBlocked, timeToBlockExpire}
`;

@Injectable()
export class ThrottlerStorageRedisService implements ThrottlerStorage {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    if (typeof this.redis.throttleIncrement !== 'function') {
      this.redis.defineCommand('throttleIncrement', {
        numberOfKeys: 2,
        lua: THROTTLE_INCREMENT_SCRIPT,
      });
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const blockKey = `throttle:block:${throttlerName}:${key}`;
    const countKey = `throttle:count:${throttlerName}:${key}`;

    const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] =
      await this.redis.throttleIncrement(
        blockKey,
        countKey,
        String(ttl),
        String(limit),
        String(blockDuration * 1000),
      );

    return {
      totalHits,
      timeToExpire,
      isBlocked: isBlocked === 1,
      timeToBlockExpire,
    };
  }
}
