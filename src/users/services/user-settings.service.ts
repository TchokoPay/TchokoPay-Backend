import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';

/**
 * 🚀 FUTURE UPGRADE: User Payment Settings Service
 *
 * Manages user's payment method configurations:
 * - MOMO (phone-based)
 * - OM/Orange Money (phone-based)
 * - Banks (account-based)
 * - Crypto (wallet address-based)
 *
 * MVP Status:
 * - Structure is in place for future implementation
 * - Currently: System fetches verified contact from contacts table automatically
 * - These endpoints return basic structure, full customization coming soon
 *
 * Future Features:
 * - Users can configure multiple phones per method
 * - Bank account management
 * - Crypto wallet management
 * - Method prioritization
 * - KYC verification per method
 */
@Injectable()
export class UserSettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get user's payment preferences
   * Returns default preferences if user hasn't customized
   */
  async getPaymentPreferences(userId: string) {
    const preferences = await this.prisma.userPaymentPreference.findUnique({
      where: { userId },
    });

    // Return defaults if not found
    if (!preferences) {
      return {
        userId,
        defaultPaymentMethod: 'MOMO',
        defaultPayoutMethod: 'MOMO',
        autoRefund: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return preferences;
  }

  /**
   * Set user's payment preferences
   */
  async setPaymentPreferences(userId: string, data: any) {
    const preferences = await this.prisma.userPaymentPreference.upsert({
      where: { userId },
      update: {
        defaultPaymentMethod: data.defaultPaymentMethod,
        defaultPayoutMethod: data.defaultPayoutMethod,
        autoRefund: data.autoRefund,
      },
      create: {
        userId,
        defaultPaymentMethod: data.defaultPaymentMethod || 'MOMO',
        defaultPayoutMethod: data.defaultPayoutMethod || 'MOMO',
        autoRefund: data.autoRefund || false,
      },
    });

    return preferences;
  }

  /**
   * Get phone number for a specific payment method
   * 
   * MVP: Returns phone from userPaymentPhoneSettings table
   * For now: System uses verified contact from contacts table automatically
   * 
   * Returns the phone associated with the payment method, or null if not set
   */
  async getPhoneForPaymentMethod(
    userId: string,
    paymentMethod: string,
  ): Promise<string | null> {
    const phoneSettings = await this.prisma.userPaymentPhoneSettings.findFirst(
      {
        where: {
          userId,
          paymentMethod: paymentMethod.toUpperCase(),
        },
      },
    );

    return phoneSettings?.phone || null;
  }

  /**
   * Set phone number for a specific payment method
   * 
   * MVP: Stores in userPaymentPhoneSettings table for future use
   * Current system still auto-fetches from verified contacts
   */
  async setPhoneForPaymentMethod(
    userId: string,
    paymentMethod: string,
    phone: string,
  ) {
    // Validate phone format
    if (!phone || phone.length < 9) {
      throw new BadRequestException('Invalid phone number');
    }

    const phoneSettings = await this.prisma.userPaymentPhoneSettings.upsert({
      where: {
        userId_paymentMethod: {
          userId,
          paymentMethod: paymentMethod.toUpperCase(),
        },
      },
      update: {
        phone,
      },
      create: {
        userId,
        paymentMethod: paymentMethod.toUpperCase(),
        phone,
      },
    });

    return phoneSettings;
  }

  /**
   * Get phone numbers for all payment methods user has configured
   */
  async getAllPhoneSettings(userId: string) {
    const phoneSettings = await this.prisma.userPaymentPhoneSettings.findMany({
      where: { userId },
      select: {
        paymentMethod: true,
        phone: true,
      },
    });

    return phoneSettings;
  }

  /**
   * Get phone for payout to a specific recipient
   * Checks if user has a preferred payout method set
   */
  async getPhoneForPayoutMethod(
    userId: string,
    payoutMethod: string,
  ): Promise<string | null> {
    return this.getPhoneForPaymentMethod(userId, payoutMethod);
  }

  /**
   * Get bank account for bank transfers
   * 
   * 🚀 FUTURE: Bank account management
   */
  async getBankAccount(userId: string) {
    const account = await this.prisma.userBankAccount.findFirst({
      where: {
        userId,
        isVerified: true,
      },
    });

    return account || null;
  }

  /**
   * Get crypto wallet for crypto payouts
   * 
   * 🚀 FUTURE: Crypto wallet management
   */
  async getCryptoWallet(userId: string, cryptoType: string) {
    const wallet = await this.prisma.userCryptoWallet.findFirst({
      where: {
        userId,
        type: cryptoType.toUpperCase(),
        isVerified: true,
      },
    });

    return wallet || null;
  }

  /**
   * Get all payout destinations for a user
   * Used to show user what payment methods are available
   * 
   * MVP: Returns basic structure
   * Future: Returns detailed info (phone, bank account, crypto wallet)
   */
  async getAvailablePayoutMethods(userId: string) {
    const [phoneSettings, bankAccounts, cryptoWallets] = await Promise.all([
      this.prisma.userPaymentPhoneSettings.findMany({
        where: { userId },
        select: { paymentMethod: true },
      }),
      this.prisma.userBankAccount.findMany({
        where: { userId, isVerified: true },
        select: { id: true, accountNumber: true },
      }),
      this.prisma.userCryptoWallet.findMany({
        where: { userId, isVerified: true },
        select: { type: true, address: true },
      }),
    ]);

    const methods: Array<{
      type: string;
      method: string;
      available: boolean;
    }> = [];

    // Add phone-based methods
    for (const { paymentMethod } of phoneSettings) {
      methods.push({
        type: 'PHONE',
        method: paymentMethod,
        available: true,
      });
    }

    // Add bank methods
    if (bankAccounts.length > 0) {
      methods.push({
        type: 'BANK',
        method: 'BANK_TRANSFER',
        available: true,
      });
    }

    // Add crypto methods
    for (const { type } of cryptoWallets) {
      methods.push({
        type: 'CRYPTO',
        method: type,
        available: true,
      });
    }

    return methods;
  }
}
