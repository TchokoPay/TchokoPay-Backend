/* eslint-disable prettier/prettier */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApplyMerchantDto } from './dto/apply-merchant.dto.js';

type AnalyticsPeriod = '7d' | '30d' | '90d';

@Injectable()
export class MerchantService {
  constructor(private prisma: PrismaService) {}

  /** Returns the caller's merchant profile, or null if they've never applied. */
  async getMyProfile(userId: string) {
    return this.prisma.merchantProfile.findUnique({ where: { userId } });
  }

  /**
   * Submit (or resubmit) a merchant application.
   * - No existing profile  -> create as PENDING.
   * - Existing REJECTED     -> edit & resubmit (reset to PENDING, clear review fields).
   * - Existing PENDING/APPROVED/SUSPENDED -> rejected, applicant must wait/contact support.
   */
  async apply(userId: string, dto: ApplyMerchantDto) {
    const existing = await this.prisma.merchantProfile.findUnique({ where: { userId } });

    if (existing) {
      switch (existing.status) {
        case 'PENDING':
          throw new BadRequestException('Your merchant application is already pending review.');
        case 'APPROVED':
          throw new BadRequestException('You are already an approved merchant.');
        case 'SUSPENDED':
          throw new BadRequestException('Your merchant account is suspended. Please contact support.');
        case 'REJECTED':
          return this.prisma.merchantProfile.update({
            where: { userId },
            data: {
              businessName: dto.businessName,
              businessType: dto.businessType,
              description: dto.description ?? null,
              status: 'PENDING',
              rejectionReason: null,
              reviewedById: null,
              reviewedAt: null,
            },
          });
      }
    }

    return this.prisma.merchantProfile.create({
      data: {
        userId,
        businessName: dto.businessName,
        businessType: dto.businessType,
        description: dto.description ?? null,
      },
    });
  }

  /**
   * Scoped analytics over the payments this merchant has received
   * (PaymentInvoice rows where they are the recipient), mirroring
   * AdminService.getAnalytics() but filtered to a single user.
   */
  async getAnalytics(userId: string, period: AnalyticsPeriod = '30d') {
    const profile = await this.prisma.merchantProfile.findUnique({ where: { userId } });
    if (!profile || profile.status !== 'APPROVED') {
      throw new ForbiddenException('Merchant access required');
    }

    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const invoices = await this.prisma.paymentInvoice.findMany({
      where: { recipientId: userId, createdAt: { gte: since } },
      select: {
        status: true,
        flow: true,
        paymentMethod: true,
        country: true,
        amount: true,
        createdById: true,
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
    });

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

    let totalVolume = 0, totalFees = 0, successCount = 0, failedCount = 0;
    const methodMap = new Map<string, { count: number; volume: number }>();
    const flowMap = new Map<string, { count: number; volume: number }>();
    const countryMap = new Map<string, { count: number; volume: number }>();
    const corridorMap = new Map<string, { count: number; volume: number }>();
    const payerIds = new Set<string>();

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
        if (inv.createdById) payerIds.add(inv.createdById);
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

      const flow = inv.flow ?? 'UNKNOWN';
      const fRow = flowMap.get(flow) ?? { count: 0, volume: 0 };
      fRow.count++;
      fRow.volume += amount;
      flowMap.set(flow, fRow);

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
        uniquePayers: payerIds.size,
      },
      txChart: dates.map((date) => ({ date, ...(txMap.get(date)!) })),
      byPaymentMethod: Array.from(methodMap.entries())
        .map(([method, data]) => ({ method, ...data }))
        .sort((a, b) => b.count - a.count),
      byFlow: Array.from(flowMap.entries())
        .map(([flow, data]) => ({ flow, ...data }))
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
}
