import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

type OtpScope = 'USER_CONTACT' | 'PAYOUT_SETTING';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(private prisma: PrismaService) {}

  generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendOtp(contactId: string) {
    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    const destination = String(
      contact?.pendingValue ?? contact?.value ?? contactId,
    );
    const channel = String(contact?.type ?? 'UNKNOWN');

    return this.issueOtp({
      scope: 'USER_CONTACT',
      subjectId: contactId,
      destination,
      channel,
      label: channel,
    });
  }

  async verifyOtp(contactId: string, code: string) {
    return this.consumeOtp({
      scope: 'USER_CONTACT',
      subjectId: contactId,
      code,
      label: contactId,
    });
  }

  async sendPaymentSettingOtp(settingId: string) {
    const setting = await this.prisma.userPaymentPhoneSettings.findUnique({
      where: { id: settingId },
      include: {
        provider: true,
      },
    });

    if (!setting) {
      throw new BadRequestException('Payout number not found');
    }

    return this.issueOtp({
      scope: 'PAYOUT_SETTING',
      subjectId: settingId,
      destination: setting.phone,
      channel: 'PHONE',
      label: setting.provider?.name ?? setting.paymentMethod,
    });
  }

  async verifyPaymentSettingOtp(settingId: string, code: string) {
    return this.consumeOtp({
      scope: 'PAYOUT_SETTING',
      subjectId: settingId,
      code,
      label: settingId,
    });
  }

  private async issueOtp(input: {
    scope: OtpScope;
    subjectId: string;
    destination: string;
    channel: string;
    label: string;
  }) {
    await this.checkRateLimit(input.scope, input.subjectId);

    const code = this.generateOtp();

    this.logOtpIssued(input.label, input.destination, code);

    await this.prisma.otpCode.create({
      data: {
        scope: input.scope,
        subjectId: input.subjectId,
        destination: input.destination,
        channel: input.channel,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    return code;
  }

  private async consumeOtp(input: {
    scope: OtpScope;
    subjectId: string;
    code: string;
    label: string;
  }) {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        scope: input.scope,
        subjectId: input.subjectId,
        code: input.code,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      this.logger.warn(
        `OTP verify FAILED  | ${input.label} | code: ${input.code}`,
      );
      throw new BadRequestException('Invalid OTP');
    }

    if (otp.expiresAt < new Date()) {
      this.logger.warn(`OTP verify EXPIRED | ${input.label}`);
      throw new BadRequestException('OTP expired');
    }

    this.logger.log(`OTP verify ✓       | ${input.label}`);
    return true;
  }

  private async checkRateLimit(scope: OtpScope, subjectId: string) {
    const lastOtp = await this.prisma.otpCode.findFirst({
      where: { scope, subjectId },
      orderBy: { createdAt: 'desc' },
    });

    if (!lastOtp) {
      return;
    }

    const diff = Date.now() - new Date(lastOtp.createdAt).getTime();
    if (diff < 60 * 1000) {
      throw new BadRequestException(
        'Please wait before requesting another OTP',
      );
    }
  }

  private logOtpIssued(type: string, destination: string, code: string) {
    const pad = (s: string, n: number) => s.padEnd(n);
    const W = 27;
    this.logger.log(
      '\n' +
        '┌─────────────────────────────────────────┐\n' +
        '│              OTP ISSUED                │\n' +
        '├─────────────────────────────────────────┤\n' +
        `│  Type        : ${pad(type, W)}│\n` +
        `│  Destination : ${pad(destination, W)}│\n` +
        `│  Code        : ${pad(code, W)}│\n` +
        `│  Expires     : ${pad('10 minutes', W)}│\n` +
        '└─────────────────────────────────────────┘',
    );
  }
}
