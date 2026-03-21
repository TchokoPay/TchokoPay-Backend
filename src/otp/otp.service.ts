import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';

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

    const code = this.generateOtp();

    this.logger.log(`OTP for contact ${contactId}: ${code}`);

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
    const otp = await this.prisma.verificationCode.findFirst({
      where: {
        contactId,
        code,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException('Invalid OTP');
    }

    if (otp.expiresAt < new Date()) {
      throw new BadRequestException('OTP expired');
    }

    return true;
  }
}