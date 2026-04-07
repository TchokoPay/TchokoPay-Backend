/* eslint-disable prettier/prettier */
import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class PaymentIdentityService {
  private readonly logger = new Logger(PaymentIdentityService.name);

  constructor(private prisma: PrismaService) {}

  // ============================
  // GET VERIFIED PHONE (PRIMARY PAYOUT SOURCE)
  // ============================
  private async getVerifiedPhone(userId: string): Promise<string> {
    const contact = await this.prisma.userContact.findFirst({
      where: {
        userId,
        type: 'PHONE',
        isVerified: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!contact) {
      throw new BadRequestException(
        'Verify your phone number before creating a payment handle',
      );
    }

    return contact.value;
  }

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

    // 1. CHECK IF ALREADY EXISTS
    const existing = await this.prisma.paymentIdentity.findUnique({
      where: { userId },
    });

    if (existing) {
      return existing;
    }

    // 2. GET USER
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // 3. ENSURE VERIFIED PHONE EXISTS
    await this.getVerifiedPhone(userId);

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
    return this.prisma.paymentIdentity.findUnique({
      where: { userId },
    });
  }

  // ============================
  // RESOLVE HANDLE → USER
  // ============================
  async resolveHandle(handle: string) {
    const identity = await this.prisma.paymentIdentity.findUnique({
      where: { handle },
      include: { user: true },
    });

    if (!identity) {
      throw new BadRequestException('Invalid handle');
    }

    return identity.user;
  }

  // ============================
  // GET PAYOUT PHONE (FOR MOMO)
  // ============================
  async getPayoutPhone(userId: string): Promise<string> {
    return this.getVerifiedPhone(userId);
  }
}