import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { UserSettingsService } from '../../users/services/user-settings.service.js';

export interface PhoneResolutionResult {
  payerPhone: string | null;
  payerName?: string;
  requiresPhone: boolean; // true if MOMO/payment method needs phone
  method: string;
}

@Injectable()
export class PhoneResolutionService {
  constructor(
    private prisma: PrismaService,
    private userSettings: UserSettingsService,
  ) {}

  /**
   * Resolve payer phone based on payment method and user type
   * - MOMO/Orange: REQUIRES phone (registered: auto-fetch, unregistered: must provide)
   * - Lightning/BTC: NO phone needed (invoice-based)
   * - BANK/CARD: NO phone needed (card/bank account required, not phone)
   */
  async resolvePayer(
    userId: string,
    paymentMethod: string,
    optionalPayerPhone?: string | undefined,
  ): Promise<PhoneResolutionResult> {
    const method = paymentMethod?.toUpperCase();

    // ✅ CRYPTO METHODS - No phone required (invoice-based)
    if (['BTC', 'LIGHTNING', 'USDT'].includes(method)) {
      return {
        payerPhone: null,
        requiresPhone: false,
        method,
      };
    }

    // ✅ MOBILE MONEY METHODS - Phone required
    if (['MOMO', 'ORANGE'].includes(method)) {
      return this.resolveMobileMoneyPayer(userId, optionalPayerPhone, method);
    }

    // ✅ CARD/BANK - No phone needed (card/account info required, not phone)
    if (['CARD', 'BANK'].includes(method)) {
      return {
        payerPhone: null,
        requiresPhone: false,
        method,
      };
    }

    throw new BadRequestException(`Unsupported payment method: ${paymentMethod}`);
  }

  /**
   * Resolve recipient phone based on payment method
   */
  async resolveRecipient(
    recipientId: string,
    payoutMethod: string,
  ): Promise<string | null> {
    const method = payoutMethod?.toUpperCase();

    // ✅ CRYPTO METHODS - No phone needed (wallet address or email)
    if (['BTC', 'LIGHTNING', 'USDT', 'CRYPTO'].includes(method)) {
      return null;
    }

    // ✅ MOBILE MONEY - Must have verified phone
    if (['MOMO', 'ORANGE'].includes(method)) {
      const setting =
        await this.userSettings.getPrimaryVerifiedPayoutSetting(recipientId);

      if (!setting) {
        throw new BadRequestException(
          'Recipient must have a verified primary payout number for mobile money payouts',
        );
      }

      if (setting.paymentMethod !== method) {
        throw new BadRequestException(
          `Recipient is not configured for ${method} payout`,
        );
      }

      return setting.phone;
    }

    // ✅ BANK - No phone needed (uses bank account info)
    if (['BANK'].includes(method)) {
      return null; // Bank details handled separately, not via phone
    }

    throw new BadRequestException(`Unsupported payout method: ${payoutMethod}`);
  }

  /**
   * Private helper for mobile money resolution
   */
  private async resolveMobileMoneyPayer(
    userId: string,
    optionalPayerPhone: string | undefined,
    method: string,
  ): Promise<PhoneResolutionResult> {
    // Try to get verified phone for registered user
    const verifiedContact = await this.prisma.userContact.findFirst({
      where: {
        userId,
        type: 'PHONE',
        isVerified: true,
      },
      include: { user: true },
    });

    if (verifiedContact) {
      return {
        payerPhone: verifiedContact.value,
        payerName: `${verifiedContact.user.firstName} ${verifiedContact.user.lastName}`,
        requiresPhone: true,
        method,
      };
    }

    // No verified contact - check if user provided one
    if (!optionalPayerPhone) {
      throw new BadRequestException(
        `${method} payment requires a verified phone number. Please provide payerPhone or verify your phone number in settings.`,
      );
    }

    // Use provided phone (unregistered user or guest)
    return {
      payerPhone: optionalPayerPhone,
      requiresPhone: true,
      method,
    };
  }
}
