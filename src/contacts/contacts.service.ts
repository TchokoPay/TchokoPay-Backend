import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { OtpService } from '../otp/otp.service.js';
import { EmailService } from '../email/email.service.js';

import { AddContactDto } from './dto/add-contact.dto.js';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private prisma: PrismaService,
    private otpService: OtpService,
    private emailService: EmailService,
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
      orderBy: [
        { isPrimary: 'desc' },
        { isVerified: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  // =====================================================
  // ➕ ADD OR UPDATE CONTACT (INDUSTRY STANDARD)
  // =====================================================
  async addContact(userId: string, dto: AddContactDto) {
    const { type, value } = dto;
    const normalizedValue = value.trim();

    this.logger.log(`Adding/updating ${type} for user ${userId}`);

    // 🚨 Check if this value already exists globally
    const existingGlobal = await this.prisma.userContact.findFirst({
      where: { value: normalizedValue },
    });

    if (existingGlobal && existingGlobal.userId !== userId) {
      throw new BadRequestException(
        `${type} already in use by another account`,
      );
    }

    if (existingGlobal && existingGlobal.userId === userId) {
      throw new BadRequestException(
        `This ${type} is already linked to your account`,
      );
    }

    const contact = await this.prisma.userContact.create({
      data: {
        userId,
        type,
        value: normalizedValue,
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

  async updateContact(
    userId: string,
    contactId: string,
    dto: AddContactDto,
  ) {
    const { type, value } = dto;
    const normalizedValue = value.trim();

    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
      include: {
        user: {
          select: {
            firstName: true,
          },
        },
      },
    });

    if (!contact || contact.userId !== userId) {
      throw new NotFoundException('Contact not found');
    }

    if (contact.type !== type) {
      throw new BadRequestException('Contact type cannot be changed');
    }

    if (contact.value === normalizedValue && !contact.pendingValue) {
      throw new BadRequestException('No contact changes detected');
    }

    const existingGlobal = await this.prisma.userContact.findFirst({
      where: { value: normalizedValue },
    });

    if (existingGlobal && existingGlobal.userId !== userId) {
      throw new BadRequestException(
        `${type} already in use by another account`,
      );
    }

    if (existingGlobal && existingGlobal.id !== contactId) {
      throw new BadRequestException(
        `This ${type} is already linked to your account`,
      );
    }

    const updated = await this.prisma.userContact.update({
      where: { id: contactId },
      data: {
        pendingValue: normalizedValue,
      },
    });

    await this.otpService.sendOtp(updated.id);

    return {
      message: `${type} change pending. Verify with OTP to apply it.`,
      contactId: updated.id,
    };
  }

  // =====================================================
  // 🔁 RESEND OTP
  // =====================================================
  async resendOtp(userId: string, contactId: string) {
    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    if (!contact || contact.userId !== userId) {
      throw new NotFoundException('Contact not found');
    }

    if (contact.isVerified && !contact.pendingValue) {
      throw new BadRequestException('Contact already verified');
    }

    await this.otpService.sendOtp(contact.id);

    return { message: 'OTP resent successfully' };
  }

  // =====================================================
  // ✅ VERIFY CONTACT
  // =====================================================
  async verifyContact(userId: string, contactId: string, code: string) {
    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    if (!contact || contact.userId !== userId) {
      throw new NotFoundException('Contact not found');
    }

    // 🔐 Verify OTP
    await this.otpService.verifyOtp(contact.id, code);

    if (contact.pendingValue) {
      const nextValue = contact.pendingValue;
      const previousValue = contact.value;
      const existingGlobal = await this.prisma.userContact.findFirst({
        where: {
          value: nextValue,
          NOT: { id: contact.id },
        },
      });

      if (existingGlobal) {
        throw new BadRequestException(
          `${contact.type} already in use by another account`,
        );
      }

      await this.prisma.userContact.update({
        where: { id: contact.id },
        data: {
          value: nextValue,
          pendingValue: null,
          isVerified: true,
        },
      });

      if (contact.type === 'EMAIL') {
        try {
          await this.emailService.sendContactVerifiedEmail({
            to: nextValue,
            firstName: contact.user.firstName,
            contactLabel: 'Email address',
            value: nextValue,
            changed: true,
          });

          await this.emailService.sendEmailAddressChangedAlert({
            to: previousValue,
            firstName: contact.user.firstName,
            newEmail: nextValue,
          });
        } catch (error) {
          this.logger.warn(
            `Contact update email failed for ${nextValue}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return { message: 'Contact updated successfully' };
    }

    const hasPrimaryOfSameType = await this.prisma.userContact.findFirst({
      where: {
        userId,
        type: contact.type,
        isPrimary: true,
        isVerified: true,
        NOT: { id: contact.id },
      },
    });

    await this.prisma.userContact.update({
      where: { id: contact.id },
      data: {
        isVerified: true,
        isPrimary: hasPrimaryOfSameType ? contact.isPrimary : true,
      },
    });

    if (contact.type === 'EMAIL') {
      try {
        await this.emailService.sendContactVerifiedEmail({
          to: contact.value,
          firstName: contact.user.firstName,
          contactLabel: 'Email address',
          value: contact.value,
        });
      } catch (error) {
        this.logger.warn(
          `Contact verification email failed for ${contact.value}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { message: 'Contact verified successfully' };
  }

  async cancelPendingChange(userId: string, contactId: string) {
    const contact = await this.prisma.userContact.findUnique({
      where: { id: contactId },
    });

    if (!contact || contact.userId !== userId) {
      throw new NotFoundException('Contact not found');
    }

    if (!contact.pendingValue) {
      throw new BadRequestException('No pending contact change found');
    }

    await this.prisma.userContact.update({
      where: { id: contactId },
      data: {
        pendingValue: null,
      },
    });

    return { message: 'Pending contact change cancelled' };
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
