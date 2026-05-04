import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';

/**
 * AdminGuard
 *
 * Validates that the authenticated user has role = ADMIN in the database.
 * The JWT claim is used for convenience only — the DB is the source of truth.
 * This guard always performs a DB lookup so a demoted admin is blocked immediately.
 *
 * Must be used AFTER JwtAuthGuard (which populates req.user).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { userId?: string } }>();
    const userId = req.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
