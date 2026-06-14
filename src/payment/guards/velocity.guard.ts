/* eslint-disable prettier/prettier */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants.js';

interface VelocityRule {
  windowMs: number;
  maxCount: number;
  message: string;
}

// Authenticated users: per-userId windows
const AUTH_RULES: VelocityRule[] = [
  { windowMs: 60_000,            maxCount: 5,   message: 'Too many payments in 1 minute — please wait.' },
  { windowMs: 60 * 60_000,       maxCount: 30,  message: 'Hourly payment limit reached.' },
  { windowMs: 24 * 60 * 60_000,  maxCount: 100, message: 'Daily payment limit reached.' },
];

// Guest users: per-IP windows (tighter — no account accountability)
const GUEST_RULES: VelocityRule[] = [
  { windowMs: 60_000,       maxCount: 2,  message: 'Too many payments in 1 minute.' },
  { windowMs: 60 * 60_000,  maxCount: 10, message: 'Hourly payment limit reached.' },
];

@Injectable()
export class VelocityGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: { userId?: string };
      ip?: string;
    }>();

    const userId: string | null = req.user?.userId ?? null;
    const ip = req.ip ?? 'unknown';
    const prefix = userId ? `vel:u:${userId}` : `vel:ip:${ip}`;
    const rules = userId ? AUTH_RULES : GUEST_RULES;

    await this.checkRules(prefix, rules);
    return true;
  }

  private async checkRules(prefix: string, rules: VelocityRule[]): Promise<void> {
    const pipeline = this.redis.pipeline();

    // Increment all windows atomically in one roundtrip
    for (const rule of rules) {
      const key = `${prefix}:${rule.windowMs}`;
      pipeline.incr(key);
      pipeline.pttl(key);
    }

    const results = await pipeline.exec();
    if (!results) return;

    const setTtlPipeline = this.redis.pipeline();
    let needsTtl = false;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const count = results[i * 2][1] as number;
      const ttlMs = results[i * 2 + 1][1] as number;
      const key = `${prefix}:${rule.windowMs}`;

      // Set TTL on first hit (key just created)
      if (ttlMs === -1) {
        setTtlPipeline.pexpire(key, rule.windowMs);
        needsTtl = true;
      }

      if (count > rule.maxCount) {
        // Fire TTL pipeline before throwing so the key doesn't leak
        if (needsTtl) await setTtlPipeline.exec();
        throw new HttpException(rule.message, HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    if (needsTtl) await setTtlPipeline.exec();
  }
}
