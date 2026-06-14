import {
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';

import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { UserStatusCacheService } from '../../redis/user-status-cache.service.js';

interface JwtPayload {
    sub: string;
    identifier: string;
    iat?: number;
    exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private prisma: PrismaService,
        private userStatusCache: UserStatusCacheService,
    ) {
        const secret = process.env.JWT_ACCESS_SECRET;

        if (!secret) {
            throw new Error(
                'JWT_ACCESS_SECRET environment variable is not set',
            );
        }

        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: secret,
        });
    }

    async validate(payload: JwtPayload) {
        if (!payload || !payload.sub) {
            throw new UnauthorizedException('Invalid token payload');
        }

        // Short-TTL Redis cache avoids a Postgres round trip on every request.
        const cachedActive = await this.userStatusCache.isActive(payload.sub);
        if (cachedActive) {
            return {
                userId: payload.sub,
                identifier: payload.identifier,
            };
        }

        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, isActive: true },
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedException('User no longer exists or is inactive');
        }

        await this.userStatusCache.markActive(user.id);

        return {
            userId: user.id,
            identifier: payload.identifier,
        };
    }
}
