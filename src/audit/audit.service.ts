import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface AuditEventDto {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /** Fire-and-forget audit write — never throws or blocks the request. */
  log(event: AuditEventDto): void {
    this.prisma.auditLog
      .create({
        data: {
          userId: event.userId ?? null,
          action: event.action,
          entity: event.entity,
          entityId: event.entityId ?? null,
          ipAddress: event.ipAddress ?? null,
          userAgent: event.userAgent ?? null,
          metadata: (event.metadata as object) ?? undefined,
        },
      })
      .catch((err) =>
        this.logger.error(`Failed to write audit log [${event.action}]:`, err),
      );
  }
}
