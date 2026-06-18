/* eslint-disable prettier/prettier */
import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { LedgerEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PaymentProviderFactory } from '../payment/providers/payment-provider.factory.js';
import { UserSettingsService } from '../users/services/user-settings.service.js';

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
  ) {}

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
    return {
      availableBalance: Number(wallet?.availableBalance ?? 0),
      currency: { code: currency.code, symbol: currency.symbol },
      // The merchant fee is taken at settlement (before funds reach the wallet),
      // so the available balance is already net and cash-out carries no fee.
      feePercent: 0,
      payoutTo: `${payout.provider.name} · ${payout.phone}`,
    };
  }

  async requestCashout(userId: string, amount: number) {
    const profile = await this.requireApprovedProfile(userId);
    if (!(amount > 0)) throw new BadRequestException('Enter an amount greater than zero');

    const payout = await this.resolveMerchantPayout(profile.id, profile.userId);
    const currency = payout.country.currency;

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

    return this.prisma.merchantCashout.update({
      where: { id },
      data: { status: 'PAID', reviewedById: adminId, reviewedAt: new Date(), externalRef: response?.transactionId ?? null },
      select: CASHOUT_SELECT,
    });
  }

  async reject(adminId: string, id: string, reason?: string) {
    const cashout = await this.prisma.merchantCashout.findUnique({ where: { id } });
    if (!cashout) throw new NotFoundException('Cashout not found');
    if (cashout.status !== 'PENDING') throw new BadRequestException('This cashout is already processed');

    // Refund the reserved funds.
    await this.creditWallet(cashout.userId, cashout.currencyId, cashout.amount, LedgerEntryType.CREDIT);

    return this.prisma.merchantCashout.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: adminId, reviewedAt: new Date(), rejectionReason: reason?.trim() || 'Rejected by admin' },
      select: CASHOUT_SELECT,
    });
  }
}
