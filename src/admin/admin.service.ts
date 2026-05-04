import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';

type AdminActionTarget = 'USER' | 'INVOICE' | 'KYC' | 'PRICING' | 'SYSTEM';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // ── Audit ─────────────────────────────────────────────────────────────────

  async log(
    adminId: string,
    action: string,
    targetType: AdminActionTarget,
    targetId?: string,
    metadata?: Record<string, unknown>,
    ipAddress?: string,
  ) {
    await this.prisma.adminAuditLog.create({
      data: { adminId, action, targetType, targetId, metadata, ipAddress },
    });
    this.logger.log(`[ADMIN] ${action} by ${adminId} → ${targetType}:${targetId ?? '*'}`);
  }

  // ── Dashboard stats ────────────────────────────────────────────────────────

  async getStats() {
    const [
      totalUsers,
      activeUsers,
      adminUsers,
      totalInvoices,
      successInvoices,
      failedInvoices,
      pendingInvoices,
      pendingKyc,
      totalVolumeCm,
      recentInvoices,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { role: 'ADMIN' } }),
      this.prisma.paymentInvoice.count(),
      this.prisma.paymentInvoice.count({ where: { status: 'SUCCESS' } }),
      this.prisma.paymentInvoice.count({ where: { status: 'FAILED' } }),
      this.prisma.paymentInvoice.count({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
      }),
      this.prisma.kyc.count({ where: { status: 'PENDING' } }),
      // Total volume in XAF (successful invoices)
      this.prisma.paymentInvoice.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      // Last 10 invoices
      this.prisma.paymentInvoice.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          currency: { select: { code: true, symbol: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    return {
      users: { total: totalUsers, active: activeUsers, admins: adminUsers },
      invoices: {
        total: totalInvoices,
        success: successInvoices,
        failed: failedInvoices,
        pending: pendingInvoices,
        successRate:
          totalInvoices > 0 ? Math.round((successInvoices / totalInvoices) * 100) : 0,
      },
      kyc: { pending: pendingKyc },
      volume: {
        total: Number(totalVolumeCm._sum.amount ?? 0),
      },
      recentInvoices: recentInvoices.map((inv) => ({
        id: inv.id,
        reference: inv.reference,
        amount: Number(inv.amount),
        currency: inv.currency.code,
        status: inv.status,
        flow: inv.flow,
        paymentMethod: inv.paymentMethod,
        payoutMethod: inv.payoutMethod,
        country: inv.country,
        createdBy: inv.createdBy
          ? `${inv.createdBy.firstName} ${inv.createdBy.lastName}`.trim()
          : 'Guest',
        createdAt: inv.createdAt,
      })),
    };
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async listUsers(params: {
    page: number;
    limit: number;
    search?: string;
    role?: string;
    isActive?: boolean;
    kycStatus?: string;
  }) {
    const { page, limit, search, role, isActive, kycStatus } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive;
    if (kycStatus) where.kycStatus = kycStatus;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { contacts: { some: { value: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          profilePicture: true,
          isActive: true,
          role: true,
          kycStatus: true,
          createdAt: true,
          contacts: { select: { type: true, value: true, isVerified: true, isPrimary: true } },
          paymentIdentity: { select: { handle: true } },
          _count: { select: { createdInvoices: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map((u) => ({
        ...u,
        displayName: `${u.firstName} ${u.lastName}`.trim(),
        handle: u.paymentIdentity?.handle ?? null,
        invoiceCount: u._count.createdInvoices,
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        contacts: true,
        kyc: true,
        paymentIdentity: true,
        wallets: { include: { currency: true } },
        _count: { select: { createdInvoices: true, recipientInvoices: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { password, refreshToken, ...safe } = user;
    return safe;
  }

  async setUserRole(adminId: string, userId: string, role: 'USER' | 'ADMIN', ip?: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, firstName: true, lastName: true, role: true },
    });

    await this.log(adminId, 'ROLE_CHANGED', 'USER', userId, { from: target.role, to: role }, ip);
    return updated;
  }

  async setUserStatus(adminId: string, userId: string, isActive: boolean, ip?: string) {
    if (userId === adminId) throw new BadRequestException('Cannot change your own status');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, firstName: true, lastName: true, isActive: true },
    });
    await this.log(adminId, isActive ? 'USER_ACTIVATED' : 'USER_BANNED', 'USER', userId, {}, ip);
    return updated;
  }

  // ── Invoices ──────────────────────────────────────────────────────────────

  async listInvoices(params: {
    page: number;
    limit: number;
    status?: string;
    flow?: string;
    country?: string;
    search?: string;
  }) {
    const { page, limit, status, flow, country, search } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (flow) where.flow = flow;
    if (country) where.country = country;
    if (search) {
      where.OR = [
        { reference: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { recipientPhone: { contains: search } },
      ];
    }

    const [invoices, total] = await Promise.all([
      this.prisma.paymentInvoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          currency: { select: { code: true, symbol: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          recipient: { select: { id: true, firstName: true, lastName: true } },
          payout: { select: { status: true, amount: true, currency: true } },
          attempts: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.paymentInvoice.count({ where }),
    ]);

    return {
      data: invoices.map((inv) => ({
        id: inv.id,
        reference: inv.reference,
        amount: Number(inv.amount),
        currency: inv.currency,
        description: inv.description,
        status: inv.status,
        flow: inv.flow,
        paymentMethod: inv.paymentMethod,
        payoutMethod: inv.payoutMethod,
        country: inv.country,
        recipientPhone: inv.recipientPhone,
        recipientName: inv.recipientName,
        createdBy: inv.createdBy,
        recipient: inv.recipient,
        payout: inv.payout,
        latestAttempt: inv.attempts[0] ?? null,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getInvoiceDetail(invoiceId: string) {
    const inv = await this.prisma.paymentInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        currency: true,
        quote: { include: { baseCurrency: true, targetCurrency: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        recipient: { select: { id: true, firstName: true, lastName: true } },
        attempts: { orderBy: { createdAt: 'desc' }, include: { currency: true } },
        payout: { include: { attempts: { orderBy: { createdAt: 'desc' } } } },
        paymentLink: true,
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  // ── KYC ──────────────────────────────────────────────────────────────────

  async listKyc(params: { page: number; limit: number; status?: string }) {
    const { page, limit, status } = params;
    const skip = (page - 1) * limit;
    const where = status ? { status: status as any } : {};

    const [items, total] = await Promise.all([
      this.prisma.kyc.findMany({
        where,
        skip,
        take: limit,
        orderBy: { submittedAt: 'desc' },
        include: { user: { select: { firstName: true, lastName: true, contacts: true } } },
      }),
      this.prisma.kyc.count({ where }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async reviewKyc(
    adminId: string,
    kycId: string,
    decision: 'VERIFIED' | 'REJECTED',
    reason?: string,
    ip?: string,
  ) {
    const kyc = await this.prisma.kyc.findUnique({ where: { id: kycId } });
    if (!kyc) throw new NotFoundException('KYC record not found');
    if (kyc.status !== 'PENDING') throw new BadRequestException('KYC is not pending');

    const [updatedKyc] = await this.prisma.$transaction([
      this.prisma.kyc.update({
        where: { id: kycId },
        data: {
          status: decision,
          reviewedAt: new Date(),
          reviewedBy: adminId,
          rejectionReason: decision === 'REJECTED' ? reason : null,
        },
      }),
      this.prisma.user.update({
        where: { id: kyc.userId },
        data: { kycStatus: decision },
      }),
    ]);

    await this.log(
      adminId,
      decision === 'VERIFIED' ? 'KYC_APPROVED' : 'KYC_REJECTED',
      'KYC',
      kycId,
      { userId: kyc.userId, reason },
      ip,
    );

    return updatedKyc;
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  async getAuditLog(params: { page: number; limit: number; adminId?: string; action?: string }) {
    const { page, limit, adminId, action } = params;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (adminId) where.adminId = adminId;
    if (action) where.action = { contains: action, mode: 'insensitive' };

    const [logs, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return { data: logs, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  // ── Bootstrap (create first admin) ───────────────────────────────────────

  async bootstrapAdmin(email: string, bootstrapToken: string) {
    const expectedToken = this.config.get<string>('ADMIN_BOOTSTRAP_TOKEN');
    if (!expectedToken || bootstrapToken !== expectedToken) {
      throw new ForbiddenException('Invalid bootstrap token');
    }

    const contact = await this.prisma.userContact.findFirst({
      where: { value: email, type: 'EMAIL' },
    });
    if (!contact) throw new NotFoundException('No account found with that email');

    const updated = await this.prisma.user.update({
      where: { id: contact.userId },
      data: { role: 'ADMIN' },
      select: { id: true, firstName: true, lastName: true, role: true },
    });

    this.logger.warn(`🛡️ Admin bootstrapped: ${updated.firstName} ${updated.lastName} (${email})`);
    return updated;
  }
}

// Need ForbiddenException import
import { ForbiddenException } from '@nestjs/common';
