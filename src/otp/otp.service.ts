import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(private prisma: PrismaService) {}

  // =====================================================
  // 🔢 GENERATE OTP
  // =====================================================
  generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // =====================================================
  // ⏱ RATE LIMIT
  // =====================================================
  async checkRateLimit(contactId: string) {
    const lastOtp = await this.prisma.verificationCode.findFirst({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
    });

    if (lastOtp) {
      const diff = Date.now() - new Date(lastOtp.createdAt).getTime();
      if (diff < 60 * 1000) {
        throw new BadRequestException(
          'Please wait before requesting another OTP',
        );
      }
    }
  }

  // =====================================================
  // 📩 SEND OTP
  // =====================================================
  async sendOtp(contactId: string) {
    await this.checkRateLimit(contactId);

    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    const code = this.generateOtp();
    const destination = String(contact?.value ?? contactId);
    const type = String(contact?.type ?? 'UNKNOWN');

    this.logOtpIssued(type, destination, code);

    await this.prisma.verificationCode.create({
      data: {
        contactId,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    return code;
  }

  // =====================================================
  // ✅ VERIFY OTP
  // =====================================================
  async verifyOtp(contactId: string, code: string) {
    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    const label = String(contact?.value ?? contactId);

    const otp = await this.prisma.verificationCode.findFirst({
      where: { contactId, code },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      this.logger.warn(`OTP verify FAILED  | ${label} | code: ${code}`);
      throw new BadRequestException('Invalid OTP');
    }

    if (otp.expiresAt < new Date()) {
      this.logger.warn(`OTP verify EXPIRED | ${label}`);
      throw new BadRequestException('OTP expired');
    }

    this.logger.log(`OTP verify ✓       | ${label}`);
    return true;
  }

  // =====================================================
  // 🖨️ PRIVATE — BOX LOGGER
  // =====================================================
  private logOtpIssued(type: string, destination: string, code: string) {
    const pad = (s: string, n: number) => s.padEnd(n);
    const W = 27;
    this.logger.log(
      '\n' +
        '┌─────────────────────────────────────────┐\n' +
        '│              🔐  OTP ISSUED              │\n' +
        '├─────────────────────────────────────────┤\n' +
        `│  Type        : ${pad(type, W)}│\n` +
        `│  Destination : ${pad(destination, W)}│\n` +
        `│  Code        : ${pad(code, W)}│\n` +
        `│  Expires     : ${pad('10 minutes', W)}│\n` +
        '└─────────────────────────────────────────┘',
    );
  }
}
