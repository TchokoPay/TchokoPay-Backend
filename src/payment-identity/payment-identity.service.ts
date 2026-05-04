/* eslint-disable prettier/prettier */
import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { UserSettingsService } from '../users/services/user-settings.service.js';
import { normalizePaymentHandle } from './payment-handle.util.js';

@Injectable()
export class PaymentIdentityService {
  private readonly logger = new Logger(PaymentIdentityService.name);

  constructor(
    private prisma: PrismaService,
    private userSettings: UserSettingsService,
  ) {}

  // ============================
  // CLEAN NAME
  // ============================
  private cleanName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '') // remove spaces
      .replace(/[^a-z0-9]/g, ''); // only alphanumeric
  }

  // ============================
  // GENERATE UNIQUE HANDLE
  // ============================
  private async generateUniqueHandle(firstName: string): Promise<string> {
    const clean = this.cleanName(firstName);

    const base = `@tchoko-${clean || 'user'}`;

    let handle = base;
    let counter = 1;

    while (
      await this.prisma.paymentIdentity.findUnique({
        where: { handle },
      })
    ) {
      handle = `${base}${counter}`;
      counter++;
    }

    return handle;
  }

  // ============================
  // CREATE PAYMENT IDENTITY
  // ============================
  async create(userId: string) {
    this.logger.log(`Creating payment identity for user ${userId}`);

    // 1. GET USER
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // 2. ENSURE VERIFIED PRIMARY PAYOUT EXISTS
    const payoutSetting =
      await this.userSettings.getPrimaryVerifiedPayoutSetting(userId);

    if (!payoutSetting) {
      throw new BadRequestException(
        'Set and verify a primary payout number before creating a payment handle',
      );
    }

    // 3. CHECK IF ALREADY EXISTS
    const existing = await this.prisma.paymentIdentity.findUnique({
      where: { userId },
    });

    if (existing) {
      return existing;
    }

    // 4. GENERATE HANDLE
    const handle = await this.generateUniqueHandle(user.firstName);

    // 5. CREATE IDENTITY
    const identity = await this.prisma.paymentIdentity.create({
      data: {
        userId,
        handle,
      },
    });

    this.logger.log(`Payment identity created: ${handle}`);

    return identity;
  }

  // ============================
  // GET MY IDENTITY
  // ============================
  async getMyIdentity(userId: string) {
    const payoutSetting =
      await this.userSettings.getPrimaryVerifiedPayoutSetting(userId);

    if (!payoutSetting) {
      return null;
    }

    return this.prisma.paymentIdentity.findUnique({
      where: { userId },
    });
  }

  // ============================
  // RESOLVE HANDLE → USER
  // ============================
  async resolveHandle(handle: string) {
    const normalizedHandle = normalizePaymentHandle(handle);
    const identity = await this.prisma.paymentIdentity.findUnique({
      where: { handle: normalizedHandle },
      include: { user: true },
    });

    if (!identity) {
      throw new BadRequestException('Invalid handle');
    }

    return identity.user;
  }

  async getPublicCheckout(rawHandle: string) {
    const normalizedHandle = normalizePaymentHandle(rawHandle);

    const identity = await this.prisma.paymentIdentity.findUnique({
      where: { handle: normalizedHandle },
      include: {
        user: true,
      },
    });

    if (!identity || !identity.user) {
      throw new BadRequestException('Invalid handle');
    }

    const payoutSetting =
      await this.userSettings.getPrimaryVerifiedPayoutSetting(identity.userId);

    if (!payoutSetting) {
      throw new BadRequestException('This handle is not ready to receive payments');
    }

    const country = await this.prisma.country.findUnique({
      where: { id: payoutSetting.countryId },
      include: { currency: true },
    });

    if (!country) {
      throw new BadRequestException('Recipient payout country is unavailable');
    }

    return {
      handle: identity.handle,
      recipient: {
        firstName: identity.user.firstName,
        lastName: identity.user.lastName,
      },
      payoutMethod: payoutSetting.paymentMethod,
      payoutProvider: payoutSetting.provider.name,
      country: {
        iso2: country.iso2,
        name: country.name,
        dialCode: country.dialCode,
      },
      currency: {
        code: country.currency.code,
        name: country.currency.name,
        symbol: country.currency.symbol,
      },
    };
  }

  // ============================
  // GET PAYOUT PHONE (FOR MOMO)
  // ============================
  async getPayoutPhone(userId: string): Promise<string> {
    const payoutSetting =
      await this.userSettings.getPrimaryVerifiedPayoutSetting(userId);

    if (!payoutSetting) {
      throw new BadRequestException(
        'No verified primary payout number found',
      );
    }

    return payoutSetting.phone;
  }
}
