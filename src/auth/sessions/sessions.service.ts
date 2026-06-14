import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';

export interface CreateSessionDto {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  deviceHash?: string;
  deviceName?: string;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private prisma: PrismaService) {}

  /** Create a new session record on login. Fire-and-forget. */
  trackLogin(dto: CreateSessionDto): void {
    this.prisma.userSession
      .create({
        data: {
          userId: dto.userId,
          ipAddress: dto.ipAddress ?? null,
          userAgent: dto.userAgent ?? null,
          deviceHash: dto.deviceHash ?? null,
          deviceName: dto.deviceName ?? null,
          lastActiveAt: new Date(),
        },
      })
      .catch((err) =>
        this.logger.error(`Failed to track session for user ${dto.userId}:`, err),
      );
  }

  /** List active (non-revoked) sessions for a user, newest first. */
  async listSessions(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId, isRevoked: false },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        deviceName: true,
        deviceHash: true,
        ipAddress: true,
        userAgent: true,
        lastActiveAt: true,
        createdAt: true,
      },
    });
  }

  /** Revoke a specific session. Only the owning user can revoke their own sessions. */
  async revokeSession(userId: string, sessionId: string) {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    return { revoked: true };
  }

  /** Revoke all sessions for a user except the current one (identified by deviceHash). */
  async revokeAllOtherSessions(userId: string, currentDeviceHash?: string) {
    const where = currentDeviceHash
      ? { userId, isRevoked: false, NOT: { deviceHash: currentDeviceHash } }
      : { userId, isRevoked: false };

    const { count } = await this.prisma.userSession.updateMany({
      where,
      data: { isRevoked: true, revokedAt: new Date() },
    });
    return { revoked: count };
  }

  /** Mark a session as active (called on each authenticated request, throttled). */
  touchSession(userId: string, deviceHash?: string): void {
    if (!deviceHash) return;
    this.prisma.userSession
      .updateMany({
        where: { userId, deviceHash, isRevoked: false },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => undefined);
  }
}
