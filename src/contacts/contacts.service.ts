import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { OtpService } from '../otp/otp.service.js';

import { AddContactDto } from './dto/add-contact.dto.js';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private prisma: PrismaService,
    private otpService: OtpService,
  ) {}

  // =====================================================
  // 📥 GET USER CONTACTS
  // =====================================================
  async getUserContacts(userId: string, query?: any) {
    const { page = 1, limit = 10, isVerified } = query || {};

    return this.prisma.userContact.findMany({
      where: {
        userId,
        ...(isVerified !== undefined && {
          isVerified: isVerified === 'true',
        }),
      },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
    });
  }

  // =====================================================
  // ➕ ADD OR UPDATE CONTACT (INDUSTRY STANDARD)
  // =====================================================
  async addContact(userId: string, dto: AddContactDto) {
    const { type, value } = dto;

    this.logger.log(`Adding/updating ${type} for user ${userId}`);

    // 🚨 Check if this value already exists globally
    const existingGlobal = await this.prisma.userContact.findFirst({
      where: { value },
    });

    if (existingGlobal && existingGlobal.userId !== userId) {
      throw new BadRequestException(
        `${type} already in use by another account`,
      );
    }

    // 🔍 Check if user already has this type
    const existingUserContact =
      await this.prisma.userContact.findFirst({
        where: { userId, type },
      });

    // ============================
    // 🔄 UPDATE FLOW (CHANGE CONTACT)
    // ============================
    if (existingUserContact) {
      // If same value → ignore
      if (existingUserContact.value === value) {
        throw new BadRequestException(
          `This ${type} is already linked to your account`,
        );
      }

      // Update existing contact (reset verification)
      const updated = await this.prisma.userContact.update({
        where: { id: existingUserContact.id },
        data: {
          value,
          isVerified: false,
        },
      });

      // Send OTP for new value
      await this.otpService.sendOtp(updated.id);

      return {
        message: `${type} updated. OTP sent for verification.`,
        contactId: updated.id,
      };
    }

    // ============================
    // ➕ CREATE FLOW (NEW CONTACT)
    // ============================
    const contact = await this.prisma.userContact.create({
      data: {
        userId,
        type,
        value,
        isPrimary: false,
        isVerified: false,
      },
    });

    // 🔐 Send OTP
    await this.otpService.sendOtp(contact.id);

    return {
      message: `${type} added. OTP sent for verification.`,
      contactId: contact.id,
    };
  }

  // =====================================================
  // 🔁 RESEND OTP
  // =====================================================
  async resendOtp(contactId: string) {
    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    if (contact.isVerified) {
      throw new BadRequestException('Contact already verified');
    }

    await this.otpService.sendOtp(contact.id);

    return { message: 'OTP resent successfully' };
  }

  // =====================================================
  // ✅ VERIFY CONTACT
  // =====================================================
  async verifyContact(contactId: string, code: string) {
    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    // 🔐 Verify OTP
    await this.otpService.verifyOtp(contact.id, code);

    await this.prisma.userContact.update({
      where: { id: contact.id },
      data: { isVerified: true },
    });

    return { message: 'Contact verified successfully' };
  }

  // =====================================================
  // ⭐ SET PRIMARY CONTACT
  // =====================================================
  async setPrimary(userId: string, contactId: string) {
    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    if (!contact || contact.userId !== userId) {
      throw new NotFoundException('Contact not found');
    }

    if (!contact.isVerified) {
      throw new BadRequestException(
        'Only verified contacts can be primary',
      );
    }

    // Remove primary of same type
    await this.prisma.userContact.updateMany({
      where: {
        userId,
        type: contact.type,
        isPrimary: true,
      },
      data: { isPrimary: false },
    });

    // Set new primary
    await this.prisma.userContact.update({
      where: { id: contactId },
      data: { isPrimary: true },
    });

    return { message: 'Primary contact updated' };
  }

  // =====================================================
  // ❌ DELETE CONTACT
  // =====================================================
  async deleteContact(userId: string, contactId: string) {
    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    if (!contact || contact.userId !== userId) {
      throw new NotFoundException('Contact not found');
    }

    if (contact.isPrimary) {
      throw new BadRequestException(
        'Cannot delete primary contact',
      );
    }

    await this.prisma.userContact.delete({
      where: { id: contactId },
    });

    return { message: 'Contact deleted successfully' };
  }
}