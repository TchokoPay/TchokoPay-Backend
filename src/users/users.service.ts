import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { TransactionStatus, type Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../prisma/prisma.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { UserSettingsService } from './services/user-settings.service.js';
import { EmailService } from '../email/email.service.js';

import cloudinary from '../config/cloudinary.config.js';

type InvoiceHistoryRow = Prisma.PaymentInvoiceGetPayload<{
  include: {
    currency: true;
    quote: {
      include: {
        baseCurrency: true;
        targetCurrency: true;
      };
    };
    createdBy: {
      include: {
        paymentIdentity: true;
      };
    };
    recipient: {
      include: {
        paymentIdentity: true;
      };
    };
    attempts: {
      include: {
        currency: true;
      };
    };
    payout: {
      include: {
        attempts: true;
      };
    };
  };
}>;

type HistoryStage =
  | 'REQUEST_OPEN'
  | 'AWAITING_PAYER'
  | 'PAYER_CONFIRMED'
  | 'PAYOUT_PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private userSettings: UserSettingsService,
    private emailService: EmailService,
  ) {}

  // =====================================================
  // 👤 GET CURRENT USER PROFILE
  // =====================================================
  async getMe(userId: string) {
    this.logger.log(`Fetching user profile for userId: ${userId}`);

    const userPromise = this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        contacts: true,
        wallets: { include: { currency: true } },
        kyc: true,
        paymentIdentity: true,
        merchantProfile: true,
      },
    });
    const payoutSettingPromise =
      this.userSettings.getPrimaryVerifiedPayoutSetting(userId);

    const user = await userPromise;
    const payoutSetting = await payoutSettingPromise;

    if (!user) {
      this.logger.warn(`User not found: ${userId}`);
      throw new NotFoundException('User not found');
    }

    const { password, refreshToken, googleId, ...safeUser } = user;

    this.logger.log(`User fetched successfully: ${userId}`);

    return {
      ...safeUser,
      paymentIdentity: payoutSetting ? safeUser.paymentIdentity : null,
      hasPassword: Boolean(password),
      usesGoogleAuth: Boolean(googleId),
    };
  }

  // =====================================================
  // ✏️ UPDATE USER PROFILE (TEXT DATA)
  // =====================================================
  async updateUser(userId: string, dto: UpdateUserDto) {
    this.logger.log(`Updating user profile: ${userId}`);

    if (!dto || Object.keys(dto).length === 0) {
      this.logger.warn(`Empty update payload for user: ${userId}`);
      throw new BadRequestException('No data provided for update');
    }

    const allowedData: Partial<UpdateUserDto> = {};

    if (dto.firstName) allowedData.firstName = dto.firstName;
    if (dto.lastName) allowedData.lastName = dto.lastName;
    if (dto.profilePicture) allowedData.profilePicture = dto.profilePicture;

    this.logger.debug(
      `Allowed update data for ${userId}: ${JSON.stringify(allowedData)}`,
    );

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: allowedData,
    });

    const { password, refreshToken, googleId, ...safeUser } = user;

    this.logger.log(`User updated successfully: ${userId}`);

    return {
      ...safeUser,
      hasPassword: Boolean(password),
      usesGoogleAuth: Boolean(googleId),
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const { currentPassword, newPassword } = dto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.password) {
      throw new BadRequestException(
        'This account uses Google sign-in and does not have a password to change.',
      );
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect');
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from your current password',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    this.logger.log(`Password changed successfully: ${userId}`);

    try {
      await this.emailService.sendPasswordChangedNotice(userId);
    } catch (error) {
      this.logger.warn(
        `Password change email failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { message: 'Password changed successfully' };
  }

  // =====================================================
  // 📋 GET USER TRANSACTION HISTORY
  // =====================================================
  async getMyTransactions(userId: string) {
    const invoices = await this.prisma.paymentInvoice.findMany({
      where: {
        OR: [{ createdById: userId }, { recipientId: userId }],
      },
      include: {
        currency: true,
        quote: {
          include: {
            baseCurrency: true,
            targetCurrency: true,
          },
        },
        createdBy: {
          include: {
            paymentIdentity: true,
          },
        },
        recipient: {
          include: {
            paymentIdentity: true,
          },
        },
        attempts: {
          include: {
            currency: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        payout: {
          include: {
            attempts: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return invoices.map((invoice) => this.mapInvoiceHistory(invoice, userId));
  }

  // =====================================================
  // 🖼️ UPLOAD & UPDATE PROFILE PICTURE
  // =====================================================
  async uploadProfilePicture(userId: string, file: Express.Multer.File) {
    this.logger.log(`Uploading profile picture for user: ${userId}`);

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // 🔐 Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.mimetype)) {
      this.logger.warn(`Invalid file type: ${file.mimetype}`);
      throw new BadRequestException('Only JPG, PNG, WEBP allowed');
    }

    // 🔍 Get existing user (for old image cleanup)
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    // 🧹 OPTIONAL: Delete old image from Cloudinary
    if (existingUser.profilePicture) {
      try {
        const publicId = this.extractPublicId(existingUser.profilePicture);
        if (publicId) {
          await cloudinary.uploader.destroy(publicId);
          this.logger.log(`Old profile image deleted: ${publicId}`);
        }
      } catch (err) {
        this.logger.warn(`Failed to delete old image: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 🚀 Upload with compression & optimization
    const result = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`, {
      folder: `tchokopay/users/${userId}`,

      // 🔥 IMAGE OPTIMIZATION (VERY IMPORTANT)
      transformation: [
        {
          width: 500,
          height: 500,
          crop: 'fill', // ensures square profile pic
          gravity: 'face', // focus on face
        },
        {
          quality: 'auto', // auto compression
          fetch_format: 'auto', // auto convert (webp, etc.)
        },
      ],
    });

    this.logger.debug(
      `Cloudinary upload result: ${JSON.stringify(result.secure_url)}`,
    );

    // 💾 Save new image URL
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        profilePicture: result.secure_url,
      },
    });

    const { password, refreshToken, googleId, ...safeUser } = user;

    this.logger.log(`Profile picture updated successfully: ${userId}`);

    return {
      ...safeUser,
      hasPassword: Boolean(password),
      usesGoogleAuth: Boolean(googleId),
    };
  }

  // =====================================================
  // 🧰 HELPER: Extract Cloudinary Public ID
  // =====================================================
  private extractPublicId(url: string): string | null {
    try {
      const parts = url.split('/');
      const fileName = parts.pop();
      const folder = parts.slice(parts.indexOf('upload') + 1).join('/');

      if (!fileName) return null;

      const publicId = `${folder}/${fileName.split('.')[0]}`;
      return publicId;
    } catch {
      return null;
    }
  }

  private mapInvoiceHistory(invoice: InvoiceHistoryRow, userId: string) {
    const role =
      invoice.createdById === userId
        ? 'PAYER'
        : invoice.recipientId === userId && invoice.flow === 'REQUEST' && !invoice.paymentMethod
          ? 'REQUESTER'
          : 'RECIPIENT';

    const direction = role === 'PAYER' ? 'OUT' : 'IN';
    const stage = this.deriveHistoryStage(invoice);
    const latestAttempt = invoice.attempts[0] ?? null;
    const payerAmount = invoice.quote?.baseAmount ?? latestAttempt?.amount ?? null;
    const payerCurrency = invoice.quote?.baseCurrency?.code ?? latestAttempt?.currency?.code ?? null;
    const recipientAmount = invoice.quote?.targetAmount ?? invoice.amount;
    const recipientCurrency = invoice.quote?.targetCurrency?.code ?? invoice.currency.code;

    const counterparty =
      role === 'PAYER'
        ? this.buildParty(invoice.recipient, invoice.recipientName, invoice.recipientPhone)
        : this.buildParty(invoice.createdBy, null, null);

    const rawProvider =
      latestAttempt?.provider ?? invoice.paymentMethod ?? null;

    return {
      id: invoice.id,
      reference: invoice.reference,
      type: invoice.flow === 'REQUEST' && role !== 'PAYER' ? 'REQUEST' : 'PAYMENT',
      role,
      direction,
      flow: invoice.flow,
      status: invoice.status,
      stage,
      stageLabel: this.getStageLabel(stage),
      // Amount from this user's perspective: what they pay (OUT) or receive (IN)
      amount:
        role === 'PAYER'
          ? (payerAmount?.toString() ?? invoice.amount.toString())
          : recipientAmount.toString(),
      currency:
        role === 'PAYER'
          ? { code: payerCurrency ?? invoice.currency.code, symbol: null }
          : { code: recipientCurrency, symbol: invoice.currency.symbol },
      // Both sides of the exchange — useful for cross-currency display
      baseAmount: payerAmount?.toString() ?? null,
      baseCurrencyCode: payerCurrency,
      targetAmount: recipientAmount.toString(),
      targetCurrencyCode: recipientCurrency,
      // Fee in payer currency; null when not yet calculated or not applicable
      fee: invoice.quote?.fee?.toString() ?? latestAttempt?.fee?.toString() ?? null,
      paymentMethod: invoice.paymentMethod,
      payoutMethod: invoice.payoutMethod,
      // Raw internal provider code
      provider: rawProvider,
      // Human-readable name mapped from paymentMethod/payoutMethod — used for logo lookup
      displayProvider: this.resolveDisplayProvider(
        invoice.paymentMethod,
        invoice.payoutMethod,
        role,
      ),
      counterparty,
      description: invoice.description,
      expiresAt: invoice.expiresAt,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }

  private deriveHistoryStage(invoice: InvoiceHistoryRow): HistoryStage {
    const latestAttempt = invoice.attempts[0] ?? null;
    const latestPayoutAttempt = invoice.payout?.attempts[0] ?? null;

    if (invoice.status === TransactionStatus.SUCCESS) {
      return 'COMPLETED';
    }

    if (invoice.status === TransactionStatus.FAILED) {
      return 'FAILED';
    }

    if (
      invoice.flow === 'REQUEST' &&
      !invoice.paymentMethod &&
      !latestAttempt &&
      new Date() > invoice.expiresAt
    ) {
      return 'EXPIRED';
    }

    if (invoice.status === TransactionStatus.CANCELLED) {
      return 'CANCELLED';
    }

    if (invoice.flow === 'REQUEST' && !invoice.paymentMethod && !latestAttempt) {
      return 'REQUEST_OPEN';
    }

    if (
      invoice.payout?.status === TransactionStatus.PROCESSING ||
      latestPayoutAttempt?.status === TransactionStatus.PROCESSING
    ) {
      return 'PAYOUT_PROCESSING';
    }

    if (latestAttempt?.status === TransactionStatus.SUCCESS) {
      return 'PAYER_CONFIRMED';
    }

    if (
      latestAttempt?.status === TransactionStatus.PROCESSING ||
      latestAttempt?.status === TransactionStatus.PENDING ||
      invoice.status === TransactionStatus.PROCESSING
    ) {
      return 'AWAITING_PAYER';
    }

    return 'AWAITING_PAYER';
  }

  private getStageLabel(stage: HistoryStage): string {
    switch (stage) {
      case 'REQUEST_OPEN':
        return 'Waiting for payer';
      case 'AWAITING_PAYER':
        return 'Waiting for payment';
      case 'PAYER_CONFIRMED':
        return 'Payment received';
      case 'PAYOUT_PROCESSING':
        return 'Paying recipient';
      case 'COMPLETED':
        return 'Completed';
      case 'FAILED':
        return 'Failed';
      case 'EXPIRED':
        return 'Expired';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return 'Pending';
    }
  }

  /**
   * Maps raw payment/payout method enum values to the human-readable provider
   * name that the frontend uses for logo lookup (PaymentMethodIcon).
   *
   * Rule: PAYER → use paymentMethod (how they paid).
   *       RECIPIENT/REQUESTER → use payoutMethod (how they received).
   */
  private resolveDisplayProvider(
    paymentMethod: string | null,
    payoutMethod: string,
    role: string,
  ): string {
    const method =
      role === 'PAYER' ? (paymentMethod ?? payoutMethod) : payoutMethod;
    switch (method?.toUpperCase()) {
      case 'BTC':
        return 'Bitcoin';
      case 'LIGHTNING':
        return 'Lightning';
      case 'MOMO':
        return 'MTN MoMo';
      case 'ORANGE':
        return 'Orange Money';
      case 'CARD':
        return 'Card';
      case 'BANK':
        return 'Bank Transfer';
      case 'CRYPTO':
        return 'Bitcoin';
      default:
        return method ?? 'TchokoPay';
    }
  }

  private buildParty(
    user:
      | {
          firstName: string;
          lastName: string;
          paymentIdentity?: { handle: string } | null;
        }
      | null
      | undefined,
    fallbackName?: string | null,
    fallbackPhone?: string | null,
  ) {
    const fullName = user
      ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
      : (fallbackName ?? null);

    return {
      name: fullName || null,
      handle: user?.paymentIdentity?.handle ?? null,
      phone: fallbackPhone ?? null,
    };
  }
}
