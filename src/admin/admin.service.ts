import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { NetwalletpayProvider } from '../payment/providers/netwalletpay.provider.js';

type AdminActionTarget = 'USER' | 'INVOICE' | 'KYC' | 'PRICING' | 'SYSTEM';

type FeeConfigInput = {
  baseCurrencyCode?: string | null;
  targetCurrencyCode?: string | null;
  paymentMethod?: string | null;
  payoutMethod?: string | null;
  flow?: string | null;
  feePercent?: number;
  spreadPercent?: number;
  priority?: number;
  isActive?: boolean;
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private netwalletpay: NetwalletpayProvider,
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

  // ── Analytics ─────────────────────────────────────────────────────────────

  async getAnalytics(period: '7d' | '30d' | '90d' = '30d') {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [invoices, newUsers, totalUsers] = await Promise.all([
      this.prisma.paymentInvoice.findMany({
        where: { createdAt: { gte: since } },
        select: {
          status: true,
          flow: true,
          paymentMethod: true,
          payoutMethod: true,
          country: true,
          amount: true,
          createdAt: true,
          quote: {
            select: {
              baseAmount: true,
              fee: true,
              baseCurrency: { select: { code: true } },
              targetCurrency: { select: { code: true } },
            },
          },
          currency: { select: { code: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.user.count(),
    ]);

    // Generate date array (ISO yyyy-mm-dd)
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    type TxDay = { success: number; failed: number; total: number; volume: number; fees: number };
    const txMap = new Map<string, TxDay>(
      dates.map((d) => [d, { success: 0, failed: 0, total: 0, volume: 0, fees: 0 }]),
    );
    const userMap = new Map<string, number>(dates.map((d) => [d, 0]));

    let totalVolume = 0, totalFees = 0, successCount = 0, failedCount = 0;
    const methodMap = new Map<string, { count: number; volume: number }>();
    const countryMap = new Map<string, { count: number; volume: number }>();
    const corridorMap = new Map<string, { count: number; volume: number }>();

    for (const inv of invoices) {
      const day = inv.createdAt.toISOString().slice(0, 10);
      const row = txMap.get(day) ?? { success: 0, failed: 0, total: 0, volume: 0, fees: 0 };
      const amount = Number(inv.quote?.baseAmount ?? inv.amount);
      const fee = Number(inv.quote?.fee ?? 0);

      row.total++;
      row.volume += amount;
      totalVolume += amount;

      if (inv.status === 'SUCCESS') {
        row.success++;
        row.fees += fee;
        totalFees += fee;
        successCount++;
      } else if (inv.status === 'FAILED') {
        row.failed++;
        failedCount++;
      }
      txMap.set(day, row);

      const method = inv.paymentMethod ?? 'UNKNOWN';
      const mRow = methodMap.get(method) ?? { count: 0, volume: 0 };
      mRow.count++;
      mRow.volume += amount;
      methodMap.set(method, mRow);

      const country = inv.country ?? 'UNKNOWN';
      const cRow = countryMap.get(country) ?? { count: 0, volume: 0 };
      cRow.count++;
      cRow.volume += amount;
      countryMap.set(country, cRow);

      const from = inv.quote?.baseCurrency?.code ?? inv.currency.code;
      const to = inv.quote?.targetCurrency?.code ?? inv.currency.code;
      const corridor = `${from}→${to}`;
      const corrRow = corridorMap.get(corridor) ?? { count: 0, volume: 0 };
      corrRow.count++;
      corrRow.volume += amount;
      corridorMap.set(corridor, corrRow);
    }

    for (const u of newUsers) {
      const day = u.createdAt.toISOString().slice(0, 10);
      userMap.set(day, (userMap.get(day) ?? 0) + 1);
    }

    return {
      period,
      summary: {
        totalVolume: Math.round(totalVolume),
        totalFees: Math.round(totalFees),
        totalTransactions: invoices.length,
        successCount,
        failedCount,
        successRate:
          invoices.length > 0 ? Math.round((successCount / invoices.length) * 100) : 0,
        avgTransactionValue:
          invoices.length > 0 ? Math.round(totalVolume / invoices.length) : 0,
        newUsers: newUsers.length,
        totalUsers,
      },
      txChart: dates.map((date) => ({ date, ...(txMap.get(date)!) })),
      userChart: dates.map((date) => ({ date, count: userMap.get(date) ?? 0 })),
      byPaymentMethod: Array.from(methodMap.entries())
        .map(([method, data]) => ({ method, ...data }))
        .sort((a, b) => b.count - a.count),
      byCountry: Array.from(countryMap.entries())
        .map(([country, data]) => ({ country, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topCorridors: Array.from(corridorMap.entries())
        .map(([corridor, data]) => ({ corridor, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }

  // ── Admin-audited Pricing CRUD ────────────────────────────────────────────

  async listAdminPricing() {
    return this.prisma.feeConfig.findMany({ orderBy: { priority: 'desc' } });
  }

  async createPricing(adminId: string, dto: FeeConfigInput, ip?: string) {
    const config = await this.prisma.feeConfig.create({
      data: {
        baseCurrencyCode: dto.baseCurrencyCode ?? null,
        targetCurrencyCode: dto.targetCurrencyCode ?? null,
        paymentMethod: dto.paymentMethod ?? null,
        payoutMethod: dto.payoutMethod ?? null,
        flow: dto.flow ?? null,
        feePercent: dto.feePercent ?? 0,
        spreadPercent: dto.spreadPercent ?? 0,
        priority: dto.priority ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.log(adminId, 'PRICING_CREATED', 'PRICING', config.id, { dto }, ip);
    return config;
  }

  async updatePricing(adminId: string, id: string, dto: FeeConfigInput, ip?: string) {
    const existing = await this.prisma.feeConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Pricing rule not found');
    const updated = await this.prisma.feeConfig.update({ where: { id }, data: dto });
    await this.log(adminId, 'PRICING_UPDATED', 'PRICING', id, { changes: dto }, ip);
    return updated;
  }

  async deletePricing(adminId: string, id: string, ip?: string) {
    const existing = await this.prisma.feeConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Pricing rule not found');
    await this.prisma.feeConfig.delete({ where: { id } });
    await this.log(adminId, 'PRICING_DELETED', 'PRICING', id, {}, ip);
    return { message: 'Deleted' };
  }

  async togglePricing(adminId: string, id: string, ip?: string) {
    const existing = await this.prisma.feeConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Pricing rule not found');
    const updated = await this.prisma.feeConfig.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });
    await this.log(adminId, 'PRICING_TOGGLED', 'PRICING', id, { isActive: updated.isActive }, ip);
    return updated;
  }

  // ── Transaction Limits ────────────────────────────────────────────────────

  async listLimits() {
    return this.prisma.transactionLimit.findMany({
      include: { currency: { select: { code: true, name: true, symbol: true, isCrypto: true } } },
      orderBy: { currencyCode: 'asc' },
    });
  }

  async upsertLimit(
    adminId: string,
    currencyCode: string,
    minAmount: number,
    maxAmount: number,
    ip?: string,
  ) {
    if (minAmount <= 0) throw new BadRequestException('minAmount must be greater than 0');
    if (maxAmount <= minAmount) throw new BadRequestException('maxAmount must be greater than minAmount');

    const currency = await this.prisma.currency.findUnique({ where: { code: currencyCode.toUpperCase() } });
    if (!currency) throw new NotFoundException(`Currency not found: ${currencyCode}`);

    const limit = await this.prisma.transactionLimit.upsert({
      where: { currencyCode: currencyCode.toUpperCase() },
      create: { currencyCode: currencyCode.toUpperCase(), minAmount, maxAmount },
      update: { minAmount, maxAmount, isActive: true },
    });
    await this.log(adminId, 'LIMIT_UPDATED', 'SYSTEM', currencyCode, { minAmount, maxAmount }, ip);
    return limit;
  }

  async toggleLimit(adminId: string, currencyCode: string, ip?: string) {
    const limit = await this.prisma.transactionLimit.findUnique({ where: { currencyCode: currencyCode.toUpperCase() } });
    if (!limit) throw new NotFoundException(`No limit configured for: ${currencyCode}`);
    const updated = await this.prisma.transactionLimit.update({
      where: { currencyCode: currencyCode.toUpperCase() },
      data: { isActive: !limit.isActive },
    });
    await this.log(adminId, limit.isActive ? 'LIMIT_DISABLED' : 'LIMIT_ENABLED', 'SYSTEM', currencyCode, {}, ip);
    return updated;
  }

  // ── Country & Provider Management ────────────────────────────────────────

  async listCountriesWithProviders() {
    return this.prisma.country.findMany({
      include: {
        currency: { select: { code: true, symbol: true } },
        providers: {
          where: { aggregator: { code: 'netwalletpay' } },
          include: { method: { select: { code: true, name: true } } },
          orderBy: { providerCode: 'asc' },
        },
      },
      orderBy: { iso2: 'asc' },
    });
  }

  async toggleCountry(adminId: string, iso2: string, ip?: string) {
    const country = await this.prisma.country.findUnique({ where: { iso2 } });
    if (!country) throw new NotFoundException('Country not found');
    const updated = await this.prisma.country.update({
      where: { iso2 },
      data: { isActive: !country.isActive },
      include: { currency: { select: { code: true } } },
    });
    await this.log(adminId, country.isActive ? 'COUNTRY_DISABLED' : 'COUNTRY_ENABLED', 'SYSTEM', iso2, { name: country.name }, ip);
    return updated;
  }

  async toggleProvider(adminId: string, providerCode: string, ip?: string) {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { providerCode },
      include: { country: true, method: true },
    });
    if (!provider) throw new NotFoundException('Provider not found');
    const updated = await this.prisma.paymentProvider.update({
      where: { providerCode },
      data: { isActive: !provider.isActive },
      include: { country: true, method: true },
    });
    await this.log(adminId, provider.isActive ? 'PROVIDER_DISABLED' : 'PROVIDER_ENABLED', 'SYSTEM', providerCode, { name: provider.name, country: provider.country.iso2 }, ip);
    return updated;
  }

  /** Calls Netwalletpay live API to check what providers they have for a given country/method.
   *  Returns a diff: what Netwalletpay has vs what our DB has. */
  async testProvider(country: string, method: string, paymentType: 'COLLECTION' | 'PAYOUT') {
    const primaryKey = this.config.get<string>('NETWALLETPAY_PRIMARY_KEY', '');
    const email      = this.config.get<string>('NETWALLETPAY_EMAIL', '');
    const baseUrl    = (this.config.get<string>('NETWALLETPAY_BASE_URL', 'https://netwalletpay.com') || '').replace(/\/+$/, '');

    if (!primaryKey || !email) {
      throw new BadRequestException('Netwalletpay credentials not configured in environment');
    }

    // ── 1. Fetch access token ────────────────────────────────────────────────
    const form = new URLSearchParams();
    form.append('primary_key', primaryKey);
    form.append('email', email);
    form.append('grant_type', 'primary_key');

    const tokenRes = await fetch(`${baseUrl}/api/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new BadRequestException(`Netwalletpay auth failed (${tokenRes.status}): ${body}`);
    }
    const tokenData = (await tokenRes.json()) as { access_token: string };
    const token = tokenData.access_token;

    // ── 2. Call provider lookup ───────────────────────────────────────────────
    const endpoint = `/api/v1/lookup/get-providers/${paymentType}/${method}/${country}`;
    const lookupRes = await fetch(`${baseUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    let netwalletpayProviders: Array<{ id: string; name: string; transactionCurrency?: string }> = [];
    let rawResponse: unknown = null;

    if (lookupRes.ok) {
      rawResponse = await lookupRes.json();
      netwalletpayProviders = (rawResponse as any)?.data ?? [];
    } else {
      rawResponse = { error: await lookupRes.text(), status: lookupRes.status };
    }

    // ── 3. Compare with our DB ────────────────────────────────────────────────
    const dbProviders = await this.prisma.paymentProvider.findMany({
      where: {
        country: { iso2: country },
        method: { code: method },
        aggregator: { code: 'netwalletpay' },
      },
      orderBy: { providerCode: 'asc' },
    });

    const nwCodes = new Set(netwalletpayProviders.map((p) => p.id));
    const dbCodes = new Set(dbProviders.map((p) => p.providerCode));

    return {
      country,
      method,
      paymentType,
      endpoint: `${baseUrl}${endpoint}`,
      netwalletpay: {
        count: netwalletpayProviders.length,
        providers: netwalletpayProviders,
        raw: rawResponse,
      },
      database: {
        count: dbProviders.length,
        providers: dbProviders.map((p) => ({
          providerCode: p.providerCode,
          name:         p.name,
          isActive:     p.isActive,
          requiresType: p.requiresType,
          inNetwalletpay: nwCodes.has(p.providerCode),
        })),
      },
      diff: {
        onlyInNetwalletpay: netwalletpayProviders.filter((p) => !dbCodes.has(p.id)).map((p) => p.id),
        onlyInDatabase:     dbProviders.filter((p) => !nwCodes.has(p.providerCode)).map((p) => p.providerCode),
      },
    };
  }

  // ── Live transaction test — delegates to the shared NetwalletpayProvider ──

  /**
   * Tests a COLLECTION (payin) or PAYOUT against a specific provider by
   * delegating to the same NetwalletpayProvider used in real payments.
   * This means it gets all the same retry logic, phone formatting,
   * MethodType handling, and fallback provider selection — no duplication.
   *
   * COLLECTION → triggers a payment prompt on the test phone.
   * PAYOUT     → attempts to transfer real funds. Use with care.
   */
  async testTransaction(params: {
    country: string;
    providerCode: string;
    paymentType: 'COLLECTION' | 'PAYOUT';
    phone: string;
    amount: number;
    adminId: string;
  }, ip?: string) {
    const { country, providerCode, paymentType, phone, amount, adminId } = params;
    const sep  = '─'.repeat(60);
    const sep2 = '═'.repeat(60);

    this.logger.log(sep2);
    this.logger.log(`🧪  ADMIN TRANSACTION TEST  —  ${paymentType}`);
    this.logger.log(sep2);
    this.logger.log(`  Admin ID   : ${adminId}`);
    this.logger.log(`  Country    : ${country}`);
    this.logger.log(`  Provider   : ${providerCode}`);
    this.logger.log(`  Phone/Acct : ${phone}`);
    this.logger.log(`  Amount     : ${amount}`);
    this.logger.log(`  IP         : ${ip ?? 'unknown'}`);
    this.logger.log(sep);

    // ── 1. Resolve provider from DB ───────────────────────────────────────────
    this.logger.log('📋  STEP 1 — Resolve provider from DB');
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { providerCode },
      include: { country: { include: { currency: true } }, method: true },
    });
    if (!provider) {
      this.logger.error(`  ❌ Provider not found in DB: ${providerCode}`);
      throw new NotFoundException(`Provider not found: ${providerCode}`);
    }
    const currency   = provider.country.currency?.code ?? 'XAF';
    const methodCode = provider.method.code; // MOBILE_MONEY | BANK | CARD
    this.logger.log(`  ✔ Provider : ${provider.name} (${providerCode})`);
    this.logger.log(`  ✔ Country  : ${provider.country.name} (${provider.country.iso2})`);
    this.logger.log(`  ✔ Method   : ${methodCode}  Currency: ${currency}`);

    // ── 2. Derive raw method hint ─────────────────────────────────────────────
    // NetwalletpayProvider.getProviderFromDb uses this hint to pick the right
    // sub-network (e.g. 'ORANGE' → orange_cm, 'MOMO' → mtn_cm).
    this.logger.log(sep);
    this.logger.log('🔧  STEP 2 — Derive method hint for provider selection');
    const id = providerCode.toLowerCase();
    let methodHint: string;
    if (methodCode === 'BANK') {
      methodHint = 'BANK';
    } else if (id.includes('orange')) {
      methodHint = 'ORANGE';
    } else {
      methodHint = 'MOMO'; // MTN, Airtel, M-Pesa, Vodacom, Tigo, AzamPesa, HaloPesa …
    }
    this.logger.log(`  providerCode : ${providerCode}`);
    this.logger.log(`  methodHint   : ${methodHint}  (passed as metadata.method)`);
    this.logger.log(`  preferredCode: ${providerCode}  (forces exact provider selection)`);

    // ── 3. Build reference + DTO ─────────────────────────────────────────────
    this.logger.log(sep);
    this.logger.log('📦  STEP 3 — Build PayinDto / PayoutDto');
    // Use the same INV- prefix so normalizeOrderId strips it to a pure numeric
    // OrderID — matching exactly what real payments send to Netwalletpay.
    const reference = `INV-${Date.now()}`;
    const dto = {
      amount,
      currency,
      phone,
      reference,
      description: `Admin test - ${paymentType} via ${providerCode}`,
      metadata: {
        country,
        method:       methodHint,   // drives mapMethod + getProviderFromDb hint
        providerCode,               // preferred provider — bypasses priority selection
      },
    };
    this.logger.log(`  reference   : ${reference}`);
    this.logger.log(`  amount      : ${amount} ${currency}`);
    this.logger.log(`  phone       : ${phone}`);
    this.logger.log(`  metadata    : ${JSON.stringify(dto.metadata)}`);

    // ── 4. Delegate to the shared NetwalletpayProvider ────────────────────────
    // This uses the identical token, phone-formatting, hash, MethodType, and
    // retry logic as a real payment — no separate HTTP stack.
    this.logger.log(sep);
    this.logger.log(`🚀  STEP 4 — Calling NetwalletpayProvider.${paymentType === 'COLLECTION' ? 'payin' : 'payout'}()`);
    this.logger.log(`  (phone formatting, hash, MethodType, retries all handled internally)`);

    let result: { status: string; transactionId?: string; error?: string; provider?: string };
    if (paymentType === 'COLLECTION') {
      result = await this.netwalletpay.payin(dto);
    } else {
      if (paymentType === 'PAYOUT') this.logger.warn('  ⚠️  PAYOUT — real funds will be transferred');
      result = await this.netwalletpay.payout(dto);
    }

    // ── 5. Log result ─────────────────────────────────────────────────────────
    this.logger.log(sep);
    this.logger.log('📊  STEP 5 — Result');
    this.logger.log(`  status         : ${result.status}`);
    this.logger.log(`  transactionId  : ${result.transactionId ?? '(none)'}`);
    if (result.error) this.logger.log(`  error          : ${result.error}`);
    if (result.provider) this.logger.log(`  providerUsed   : ${result.provider}`);

    const ok = result.status === 'SUCCESS';
    if (ok) {
      this.logger.log(sep2);
      this.logger.log(`✅  TEST PASSED  —  ${paymentType}  |  ${providerCode}  |  ${amount} ${currency}`);
      this.logger.log(sep2);
    } else {
      this.logger.error(sep2);
      this.logger.error(`❌  TEST FAILED  —  ${paymentType}  |  ${providerCode}  |  ${result.error ?? 'unknown error'}`);
      this.logger.error(sep2);
    }

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    await this.log(adminId, `PROVIDER_TX_TEST_${paymentType}`, 'SYSTEM', providerCode, {
      country, phone, amount, currency, ok,
      transactionId: result.transactionId ?? null,
      error: result.error ?? null,
    }, ip);

    return {
      ok,
      paymentType,
      country,
      providerCode,
      providerName:  provider.name,
      currency,
      amount,
      phone,
      orderId:       reference,
      transactionId: result.transactionId ?? null,
      message:       ok ? 'Transaction accepted' : (result.error ?? 'Transaction failed'),
      raw:           result,
    };
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

