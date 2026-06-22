/* eslint-disable prettier/prettier */
import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { LedgerEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PaymentProviderFactory } from '../payment/providers/payment-provider.factory.js';
import { UserSettingsService } from '../users/services/user-settings.service.js';
import { EmailService } from '../email/email.service.js';

/** Fallback minimum withdrawal if the platform config isn't set. */
const DEFAULT_MIN_WITHDRAWAL = 500;

const CASHOUT_SELECT = {
  id: true,
  reference: true,
  amount: true,
  fee: true,
  netAmount: true,
  status: true,
  payoutPhone: true,
  payoutMethod: true,
  country: true,
  externalRef: true,
  rejectionReason: true,
  createdAt: true,
  reviewedAt: true,
  userId: true,
  currency: { select: { code: true, symbol: true } },
  merchantProfile: { select: { businessName: true } },
} satisfies Prisma.MerchantCashoutSelect;

@Injectable()
export class MerchantCashoutService {
  private readonly logger = new Logger(MerchantCashoutService.name);

  constructor(
    private prisma: PrismaService,
    private providerFactory: PaymentProviderFactory,
    private userSettings: UserSettingsService,
    private emailService: EmailService,
  ) {}

  /** Admin-configured minimum withdrawal amount (PlatformConfig). */
  private async minWithdrawal(): Promise<number> {
    const cfg = await this.prisma.platformConfig.findUnique({
      where: { id: 'singleton' },
      select: { minWithdrawalAmount: true },
    });
    return cfg?.minWithdrawalAmount ?? DEFAULT_MIN_WITHDRAWAL;
  }

  private async requireApprovedProfile(userId: string) {
    const profile = await this.prisma.merchantProfile.findUnique({ where: { userId } });
    if (!profile || profile.status !== 'APPROVED') {
      throw new ForbiddenException('Merchant access required');
    }
    return profile;
  }

  /** The verified payout a merchant withdraws to (storefront handle first, else primary). */
  private async resolveMerchantPayout(merchantProfileId: string, ownerUserId: string) {
    const identity = await this.prisma.paymentIdentity.findUnique({
      where: { merchantProfileId },
      select: { payoutSetting: { select: { id: true, isVerified: true } } },
    });
    let payoutId = identity?.payoutSetting?.isVerified ? identity.payoutSetting.id : null;
    if (!payoutId) {
      const primary = await this.userSettings.getPrimaryVerifiedPayoutSetting(ownerUserId);
      payoutId = primary?.id ?? null;
    }
    if (!payoutId) throw new BadRequestException('Add a verified payout number before withdrawing');

    const payout = await this.prisma.userPaymentPhoneSettings.findUnique({
      where: { id: payoutId },
      include: { provider: true, country: { include: { currency: true } } },
    });
    if (!payout || !payout.isVerified) {
      throw new BadRequestException('Add a verified payout number before withdrawing');
    }
    return payout;
  }

  private async creditWallet(userId: string, currencyId: string, amount: Prisma.Decimal, type: LedgerEntryType) {
    const wallet = await this.prisma.wallet.findFirst({ where: { userId, currencyId } });
    if (!wallet) return;
    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: type === LedgerEntryType.DEBIT ? { decrement: amount } : { increment: amount } },
    });
    await this.prisma.ledger.create({
      data: { wallet: { connect: { id: wallet.id } }, amount, type, balanceAfter: updated.availableBalance },
    });
  }

  // ── Merchant ────────────────────────────────────────────────────────────────

  /** Quote what a withdrawal of `amount` would cost (fee) + available balance. */
  async quoteCashout(userId: string) {
    const profile = await this.requireApprovedProfile(userId);
    const payout = await this.resolveMerchantPayout(profile.id, profile.userId);
    const currency = payout.country.currency;
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, currencyId: currency.id },
      select: { availableBalance: true },
    });
    const pending = await this.prisma.merchantCashout.findFirst({
      where: { userId, status: 'PENDING' },
      select: { id: true },
    });
    return {
      availableBalance: Number(wallet?.availableBalance ?? 0),
      currency: { code: currency.code, symbol: currency.symbol },
      // The merchant fee is taken at settlement (before funds reach the wallet),
      // so the available balance is already net and cash-out carries no fee.
      feePercent: 0,
      minAmount: await this.minWithdrawal(),
      hasPending: !!pending,
      payoutTo: `${payout.provider.name} · ${payout.phone}`,
    };
  }

  /**
   * Per-event breakdown of what makes up the wallet balance. Built from the
   * ledger so it reconciles exactly: availableBalance = totalSettled − totalWithdrawn.
   * Each event/link's `net` is the sum of the (post-merchant-fee) amounts it
   * actually credited to the wallet.
   */
  async getBalanceBreakdown(userId: string) {
    const profile = await this.requireApprovedProfile(userId);
    const payout = await this.resolveMerchantPayout(profile.id, profile.userId);
    const currency = payout.country.currency;
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, currencyId: currency.id },
      select: { id: true, availableBalance: true },
    });

    const base = {
      currency: { code: currency.code, symbol: currency.symbol },
      availableBalance: Number(wallet?.availableBalance ?? 0),
      totalSettled: 0,
      totalWithdrawn: 0,
      events: [] as Array<{ id: string; title: string; kind: string | null; count: number; net: number }>,
    };
    if (!wallet) return base;

    const [credits, withdrawnAgg] = await Promise.all([
      this.prisma.ledger.findMany({
        where: { walletId: wallet.id, type: LedgerEntryType.CREDIT },
        select: {
          amount: true,
          invoiceId: true,
          invoice: {
            select: {
              paymentLinkId: true,
              merchantPaymentLink: { select: { title: true, reason: true, kind: true } },
            },
          },
        },
      }),
      this.prisma.ledger.aggregate({
        where: { walletId: wallet.id, type: LedgerEntryType.DEBIT },
        _sum: { amount: true },
      }),
    ]);

    const map = new Map<string, { id: string; title: string; kind: string | null; count: number; net: number }>();
    let totalSettled = 0;
    for (const c of credits) {
      const link = c.invoice?.merchantPaymentLink;
      const key = c.invoice?.paymentLinkId ?? (c.invoiceId ? 'direct' : 'adjustments');
      const title =
        link?.title ||
        link?.reason ||
        (key === 'direct' ? 'Direct payments' : key === 'adjustments' ? 'Refunds & adjustments' : 'Untitled');
      const e = map.get(key) ?? { id: key, title, kind: link?.kind ?? null, count: 0, net: 0 };
      const amt = Number(c.amount);
      e.count += 1;
      e.net += amt;
      totalSettled += amt;
      map.set(key, e);
    }

    return {
      currency: { code: currency.code, symbol: currency.symbol },
      availableBalance: Number(wallet.availableBalance),
      totalSettled: Math.round(totalSettled),
      totalWithdrawn: Math.round(Number(withdrawnAgg._sum.amount ?? 0)),
      events: [...map.values()].map((e) => ({ ...e, net: Math.round(e.net) })).sort((a, b) => b.net - a.net),
    };
  }

  async requestCashout(userId: string, amount: number) {
    const profile = await this.requireApprovedProfile(userId);
    if (!(amount > 0)) throw new BadRequestException('Enter an amount greater than zero');

    const payout = await this.resolveMerchantPayout(profile.id, profile.userId);
    const currency = payout.country.currency;

    const min = await this.minWithdrawal();
    if (amount < min) {
      throw new BadRequestException(`Minimum withdrawal is ${min} ${currency.code}`);
    }

    // One pending withdrawal at a time — keeps reserved balances clear.
    const existingPending = await this.prisma.merchantCashout.findFirst({
      where: { userId, status: 'PENDING' },
      select: { id: true },
    });
    if (existingPending) {
      throw new BadRequestException('You already have a withdrawal awaiting approval. Please wait for it to be processed.');
    }

    const wallet = await this.prisma.wallet.findFirst({ where: { userId, currencyId: currency.id } });
    const available = Number(wallet?.availableBalance ?? 0);
    if (!wallet || available < amount) throw new BadRequestException('Insufficient available balance');

    // Fee is already applied at settlement, so the wallet balance is net —
    // a cash-out withdraws the full requested amount with no further fee.
    const fee = 0;
    const netAmount = amount;

    const amountDec = new Prisma.Decimal(amount);
    // Reserve the funds immediately so they can't be double-withdrawn.
    await this.creditWallet(userId, currency.id, amountDec, LedgerEntryType.DEBIT);

    const reference = `CO-${Date.now()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const cashout = await this.prisma.merchantCashout.create({
      data: {
        reference,
        merchantProfile: { connect: { id: profile.id } },
        userId,
        amount: amountDec,
        fee: new Prisma.Decimal(fee),
        netAmount: new Prisma.Decimal(netAmount),
        currency: { connect: { id: currency.id } },
        payoutPhone: payout.phone,
        payoutMethod: payout.paymentMethod,
        payoutProviderCode: payout.provider.providerCode,
        country: payout.country.iso2,
      },
      select: CASHOUT_SELECT,
    });
    this.logger.log(`💸 Cashout requested ${reference}: ${amount} ${currency.code} (fee ${fee})`);
    return cashout;
  }

  async listMyCashouts(userId: string) {
    await this.requireApprovedProfile(userId);
    return this.prisma.merchantCashout.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: CASHOUT_SELECT,
    });
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async adminList(status?: string) {
    return this.prisma.merchantCashout.findMany({
      where: status ? { status: status as never } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      select: CASHOUT_SELECT,
    });
  }

  /** Full context for the admin review panel: request + merchant balance + history. */
  async adminGetCashoutDetail(id: string) {
    const cashout = await this.prisma.merchantCashout.findUnique({
      where: { id },
      select: { ...CASHOUT_SELECT, currencyId: true, payoutProviderCode: true },
    });
    if (!cashout) throw new NotFoundException('Cashout not found');

    const [wallet, history] = await Promise.all([
      this.prisma.wallet.findFirst({
        where: { userId: cashout.userId, currencyId: cashout.currencyId },
        select: { availableBalance: true },
      }),
      this.prisma.merchantCashout.findMany({
        where: { userId: cashout.userId, id: { not: id } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, reference: true, netAmount: true, status: true, createdAt: true },
      }),
    ]);

    return {
      cashout,
      availableBalance: Number(wallet?.availableBalance ?? 0),
      history: history.map((h) => ({ ...h, netAmount: Number(h.netAmount) })),
    };
  }

  async approve(adminId: string, id: string) {
    const cashout = await this.prisma.merchantCashout.findUnique({
      where: { id },
      include: { currency: true },
    });
    if (!cashout) throw new NotFoundException('Cashout not found');
    if (cashout.status !== 'PENDING') throw new BadRequestException('This cashout is already processed');

    let response: { status?: string; transactionId?: string; error?: string } | null = null;
    try {
      const provider = this.providerFactory.getProvider(
        cashout.payoutMethod ?? 'MOMO',
        cashout.country ?? 'CM',
      );
      response = await provider.payout({
        amount: Number(cashout.netAmount),
        currency: cashout.currency.code,
        phone: cashout.payoutPhone ?? undefined,
        reference: cashout.reference,
        description: 'TchokoPay merchant withdrawal',
        metadata: {
          country: cashout.country ?? undefined,
          method: cashout.payoutMethod ?? undefined,
          providerCode: cashout.payoutProviderCode ?? undefined,
          type: 'PAYOUT',
        },
      });
    } catch (err) {
      response = { status: 'FAILED', error: err instanceof Error ? err.message : 'Payout error' };
    }

    if (response?.status === 'FAILED') {
      // Refund the reserved funds back to the wallet.
      await this.creditWallet(cashout.userId, cashout.currencyId, cashout.amount, LedgerEntryType.CREDIT);
      this.logger.error(`Cashout ${cashout.reference} payout FAILED: ${response.error}`);
      return this.prisma.merchantCashout.update({
        where: { id },
        data: { status: 'FAILED', reviewedById: adminId, reviewedAt: new Date(), rejectionReason: response.error ?? 'Payout failed' },
        select: CASHOUT_SELECT,
      });
    }

    void this.notifyMerchant(cashout.userId, cashout.reference, Number(cashout.netAmount), cashout.currency.code, cashout.payoutMethod, 'PAID');
    return this.prisma.merchantCashout.update({
      where: { id },
      data: { status: 'PAID', reviewedById: adminId, reviewedAt: new Date(), externalRef: response?.transactionId ?? null },
      select: CASHOUT_SELECT,
    });
  }

  async reject(adminId: string, id: string, reason?: string) {
    const cashout = await this.prisma.merchantCashout.findUnique({
      where: { id },
      include: { currency: true },
    });
    if (!cashout) throw new NotFoundException('Cashout not found');
    if (cashout.status !== 'PENDING') throw new BadRequestException('This cashout is already processed');

    // Refund the reserved funds.
    await this.creditWallet(cashout.userId, cashout.currencyId, cashout.amount, LedgerEntryType.CREDIT);

    const finalReason = reason?.trim() || 'Rejected by admin';
    void this.notifyMerchant(cashout.userId, cashout.reference, Number(cashout.netAmount), cashout.currency.code, cashout.payoutMethod, 'REJECTED', finalReason);
    return this.prisma.merchantCashout.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: adminId, reviewedAt: new Date(), rejectionReason: finalReason },
      select: CASHOUT_SELECT,
    });
  }

  /** Email the merchant when a withdrawal is paid or rejected (best-effort). */
  private async notifyMerchant(
    userId: string,
    reference: string,
    amount: number,
    currency: string,
    payoutMethod: string | null,
    status: 'PAID' | 'REJECTED',
    reason?: string | null,
  ) {
    try {
      await this.emailService.sendWithdrawalStatusNotice({
        userId,
        status,
        reference,
        amount,
        currency,
        payoutMethod: payoutMethod ?? 'mobile money',
        reason: reason ?? null,
      });
    } catch (e) {
      this.logger.warn(`Withdrawal email failed for ${reference}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
