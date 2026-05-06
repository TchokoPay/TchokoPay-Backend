import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { OtpService } from '../../otp/otp.service.js';
import { EmailService } from '../../email/email.service.js';

type MobileMoneyProviderOption = {
  id: string;
  code: string;
  name: string;
  paymentMethod: string;
  country: {
    iso2: string;
    name: string;
    dialCode: string | null;
  };
};

@Injectable()
export class UserSettingsService {
  private readonly logger = new Logger(UserSettingsService.name);

  constructor(
    private prisma: PrismaService,
    private otpService: OtpService,
    private emailService: EmailService,
  ) {}

  async getPaymentSettings(userId: string) {
    const settings = await this.prisma.userPaymentPhoneSettings.findMany({
      where: { userId, isUserConfirmed: true },
      include: {
        country: true,
        provider: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });

    const primary = settings.find((setting) => setting.isPrimary) ?? null;
    const bootstrapSuggestion =
      settings.length === 0
        ? await this.getBootstrapSuggestionFromVerifiedContact(userId)
        : null;

    return {
      primary,
      mobileMoneyNumbers: settings,
      bootstrapSuggestion,
    };
  }

  async getSupportedMobileMoneyProviders(
    countryIso2: string,
  ): Promise<MobileMoneyProviderOption[]> {
    const country = countryIso2.trim().toUpperCase();

    const providers = await this.prisma.paymentProvider.findMany({
      where: {
        aggregator: { code: 'netwalletpay', isActive: true },
        country: { iso2: country, isActive: true },
        method: { code: 'MOBILE_MONEY', isActive: true },
        isActive: true,
      },
      include: {
        country: true,
      },
      orderBy: [{ providerCode: 'asc' }],
    });

    return providers.map((provider) => ({
      id: provider.id,
      code: provider.providerCode,
      name: provider.name,
      paymentMethod: this.mapProviderCodeToPaymentMethod(provider.providerCode),
      country: {
        iso2: provider.country.iso2,
        name: provider.country.name,
        dialCode: provider.country.dialCode,
      },
    }));
  }

  async addMobileMoneyNumber(
    userId: string,
    input: {
      country: string;
      providerCode: string;
      phone: string;
    },
  ) {
    const provider = await this.getProviderForCountry(
      input.country,
      input.providerCode,
    );
    const normalizedPhone = this.normalizePhone(
      input.phone,
      provider.country.dialCode,
    );

    await this.ensurePhoneAvailable(userId, normalizedPhone);

    const existingForUser = await this.prisma.userPaymentPhoneSettings.findFirst({
      where: {
        userId,
        phone: normalizedPhone,
      },
      include: {
        country: true,
        provider: true,
      },
    });

    if (existingForUser?.isUserConfirmed) {
      throw new BadRequestException(
        'This mobile money number is already in your payout settings.',
      );
    }

    const settingsCount = await this.prisma.userPaymentPhoneSettings.count({
      where: { userId, isUserConfirmed: true },
    });

    const setting = existingForUser
      ? await this.prisma.userPaymentPhoneSettings.update({
          where: { id: existingForUser.id },
          data: {
            paymentMethod: this.mapProviderCodeToPaymentMethod(
              provider.providerCode,
            ),
            countryId: provider.countryId,
            providerId: provider.id,
            isPrimary: settingsCount === 0,
            isVerified: false,
            isUserConfirmed: true,
            verifiedAt: null,
          },
          include: {
            country: true,
            provider: true,
          },
        })
      : await this.prisma.userPaymentPhoneSettings.create({
          data: {
            userId,
            paymentMethod: this.mapProviderCodeToPaymentMethod(
              provider.providerCode,
            ),
            phone: normalizedPhone,
            countryId: provider.countryId,
            providerId: provider.id,
            isPrimary: settingsCount === 0,
            isVerified: false,
            isUserConfirmed: true,
          },
          include: {
            country: true,
            provider: true,
          },
        });

    await this.otpService.sendPaymentSettingOtp(setting.id);

    return {
      message: 'Mobile money number added. Verify it to use it for payouts.',
      setting,
    };
  }

  async resendMobileMoneyOtp(userId: string, settingId: string) {
    const setting = await this.prisma.userPaymentPhoneSettings.findUnique({
      where: { id: settingId },
    });

    if (!setting || setting.userId !== userId) {
      throw new NotFoundException('Payout number not found');
    }

    if (setting.isVerified) {
      throw new BadRequestException('This payout number is already verified');
    }

    await this.otpService.sendPaymentSettingOtp(setting.id);

    return { message: 'Verification code sent' };
  }

  async verifyMobileMoneyNumber(
    userId: string,
    settingId: string,
    code: string,
  ) {
    const setting = await this.prisma.userPaymentPhoneSettings.findUnique({
      where: { id: settingId },
      include: {
        country: true,
        provider: true,
      },
    });

    if (!setting || setting.userId !== userId) {
      throw new NotFoundException('Payout number not found');
    }

    await this.otpService.verifyPaymentSettingOtp(setting.id, code);

    const otherVerifiedPrimary =
      await this.prisma.userPaymentPhoneSettings.findFirst({
        where: {
          userId,
          isPrimary: true,
          isVerified: true,
          NOT: { id: setting.id },
        },
      });

    const updated = await this.prisma.userPaymentPhoneSettings.update({
      where: { id: setting.id },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
        isUserConfirmed: true,
        isPrimary: otherVerifiedPrimary ? setting.isPrimary : true,
      },
      include: {
        country: true,
        provider: true,
      },
    });

    try {
      await this.emailService.sendPayoutRouteVerifiedNotice({
        userId,
        phone: updated.phone,
        providerName: updated.provider.name,
        countryName: updated.country.name,
        isPrimary: updated.isPrimary,
      });
    } catch (error) {
      this.logger.warn(
        `Payout verification email failed for ${updated.phone}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      message: 'Payout number verified successfully',
      setting: updated,
    };
  }

  async setPrimaryMobileMoneyNumber(userId: string, settingId: string) {
    const setting = await this.prisma.userPaymentPhoneSettings.findUnique({
      where: { id: settingId },
    });

    if (!setting || setting.userId !== userId) {
      throw new NotFoundException('Payout number not found');
    }

    if (!setting.isVerified) {
      throw new BadRequestException(
        'Only verified payout numbers can be made primary',
      );
    }

    if (!setting.isUserConfirmed) {
      throw new BadRequestException(
        'Choose and verify this payout route before making it primary',
      );
    }

    await this.prisma.userPaymentPhoneSettings.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });

    const updated = await this.prisma.userPaymentPhoneSettings.update({
      where: { id: settingId },
      data: { isPrimary: true },
      include: {
        country: true,
        provider: true,
      },
    });

    try {
      await this.emailService.sendPrimaryPayoutChangedNotice({
        userId,
        phone: updated.phone,
        providerName: updated.provider.name,
        countryName: updated.country.name,
      });
    } catch (error) {
      this.logger.warn(
        `Primary payout email failed for ${updated.phone}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.prisma.userPaymentPreference.upsert({
      where: { userId },
      update: {
        defaultPayoutMethod: updated.paymentMethod,
      },
      create: {
        userId,
        defaultPaymentMethod: 'MOMO',
        defaultPayoutMethod: updated.paymentMethod,
      },
    });

    return {
      message: 'Primary payout number updated',
      setting: updated,
    };
  }

  async getPrimaryVerifiedPayoutSetting(userId: string) {
    const primary =
      (await this.prisma.userPaymentPhoneSettings.findFirst({
        where: {
          userId,
          isPrimary: true,
          isVerified: true,
          isUserConfirmed: true,
        },
        include: {
          country: true,
          provider: true,
        },
      })) ??
      (await this.prisma.userPaymentPhoneSettings.findFirst({
        where: {
          userId,
          isVerified: true,
          isUserConfirmed: true,
        },
        include: {
          country: true,
          provider: true,
        },
        orderBy: { createdAt: 'asc' },
      }));

    return primary;
  }
  private async getBootstrapSuggestionFromVerifiedContact(userId: string) {
    const contact = await this.prisma.userContact.findFirst({
      where: {
        userId,
        type: 'PHONE',
        isVerified: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!contact) {
      return null;
    }

    const country = await this.findCountryFromPhone(contact.value);
    if (!country) {
      return null;
    }

    const normalizedPhone = this.normalizePhone(contact.value, country.dialCode);
    const providers = await this.getSupportedMobileMoneyProviders(country.iso2);

    return {
      phone: normalizedPhone,
      country: {
        iso2: country.iso2,
        dialCode: country.dialCode,
      },
      requiresProviderSelection: providers.length !== 1,
    };
  }

  private async getProviderForCountry(countryIso2: string, providerCode: string) {
    const provider = await this.prisma.paymentProvider.findFirst({
      where: {
        providerCode: providerCode.trim().toLowerCase(),
        aggregator: { code: 'netwalletpay', isActive: true },
        country: { iso2: countryIso2.trim().toUpperCase(), isActive: true },
        method: { code: 'MOBILE_MONEY', isActive: true },
        isActive: true,
      },
      include: {
        country: true,
      },
    });

    if (!provider) {
      throw new BadRequestException('Unsupported mobile money provider');
    }

    return provider;
  }

  private async ensurePhoneAvailable(userId: string, phone: string) {
    const existingSetting = await this.prisma.userPaymentPhoneSettings.findFirst({
      where: {
        phone,
        NOT: { userId },
      },
    });

    if (existingSetting) {
      throw new BadRequestException(
        'This number is already linked to another payout profile.',
      );
    }

    const existingContact = await this.prisma.userContact.findFirst({
      where: {
        value: phone,
        NOT: { userId },
      },
    });

    if (existingContact) {
      throw new BadRequestException(
        'This number is already linked to another account.',
      );
    }
  }

  private normalizePhone(phone: string, dialCode: string | null) {
    const digits = phone.replace(/[^\d+]/g, '');

    if (digits.startsWith('+')) {
      return digits;
    }

    const prefix = dialCode?.replace(/\s+/g, '') ?? '';
    if (!prefix) {
      throw new BadRequestException(
        'This country is missing a dial code configuration.',
      );
    }

    const countryDigits = prefix.replace('+', '');
    const localDigits = digits.replace(/^0+/, '');

    return `+${countryDigits}${localDigits}`;
  }

  private mapProviderCodeToPaymentMethod(providerCode: string) {
    return providerCode.toLowerCase().includes('orange') ? 'ORANGE' : 'MOMO';
  }

  private async findCountryFromPhone(phone: string) {
    const normalized = phone.startsWith('+') ? phone : `+${phone}`;
    const countries = await this.prisma.country.findMany({
      where: { isActive: true },
      select: { id: true, iso2: true, dialCode: true },
    });

    return countries
      .filter((country) => country.dialCode)
      .sort((a, b) => (b.dialCode?.length ?? 0) - (a.dialCode?.length ?? 0))
      .find((country) => normalized.startsWith(country.dialCode ?? ''));
  }

}
