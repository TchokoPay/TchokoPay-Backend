import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { JwtService } from '@nestjs/jwt';

import * as bcrypt from 'bcrypt';

import { SignupDto } from './dto/signup.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyDto } from './dto/verify.dto.js';

import { GoogleAuthService } from '../google/google-auth.service.js';
import { generateTokens } from './utils/tokens.js';
import { OtpService } from '../otp/otp.service.js';
import { EmailService } from '../email/email.service.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private googleAuth: GoogleAuthService,
    private otpService: OtpService,
    private emailService: EmailService,
  ) {}

  private normalizeIdentifier(identifier: string) {
    const trimmed = identifier.trim();
    return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
  }

  /** Fetch the user's role for embedding in the JWT payload. */
  private async getUserRole(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role ?? 'USER';
  }

  private async storeRefreshToken(userId: string, refreshToken: string) {
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedRefreshToken },
    });
  }

  private async getTokenIdentifier(userId: string, fallback: string) {
    const primaryContact = await this.prisma.userContact.findFirst({
      where: { userId, isPrimary: true },
      orderBy: { createdAt: 'asc' },
    });

    return primaryContact?.value || fallback;
  }

  // =====================================================
  // 🚀 SIGNUP (STRICT INDUSTRY STANDARD)
  // =====================================================
  async signup(dto: SignupDto) {
    const { email, phone, password, firstName, lastName } = dto;

    // ── Must provide exactly ONE identifier ───────────────────────────────────
    if (email && phone) {
      throw new BadRequestException(
        'Provide either an email address or a phone number — not both.',
      );
    }
    if (!email && !phone) {
      throw new BadRequestException(
        'An email address or phone number is required.',
      );
    }

    const type = email ? 'EMAIL' : 'PHONE';

    // ── Server-side format guards (belt-and-suspenders on top of DTO) ─────────
    if (email) {
      // Reject anything that looks purely numeric (someone typed a phone into email field)
      if (/^\+?\d+$/.test(email.trim())) {
        throw new BadRequestException(
          "That doesn't look like a valid email address. Did you mean to use your phone number?",
        );
      }
      // Basic RFC structure: must contain @ and a domain
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
        throw new BadRequestException(
          'Please enter a valid email address (e.g. you@example.com).',
        );
      }
    }

    if (phone) {
      // Reject if contains letters or @ (someone typed email into phone field)
      if (/[a-zA-Z@]/.test(phone)) {
        throw new BadRequestException(
          'Phone number must contain digits only — no letters or email addresses.',
        );
      }
      // Must be E.164: +[1-9][6-14 digits]
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
        throw new BadRequestException(
          'Phone must be in international format (e.g. +237670000000).',
        );
      }
    }

    const identifier = this.normalizeIdentifier((email || phone) as string);

    this.logger.log(`Signup attempt [${type}]: ${identifier}`);

    // ── Global uniqueness — across ALL users and ALL contact types ─────────────
    const existingContact = await this.prisma.userContact.findFirst({
      where: { value: identifier },
      include: {
        user: true,
      },
    });

    if (existingContact) {
      if (!existingContact.isVerified) {
        const hashedPasswordRetry = await bcrypt.hash(password, 12);

        await this.prisma.user.update({
          where: { id: existingContact.userId },
          data: {
            firstName,
            lastName,
            password: hashedPasswordRetry,
          },
        });

        await this.otpService.sendOtp(existingContact.id);

        return {
          message: 'Account pending verification. A new OTP has been sent.',
          contactId: existingContact.id,
        };
      }

      if (type === 'EMAIL') {
        throw new BadRequestException(
          'An account with this email address already exists. Please sign in instead.',
        );
      }
      throw new BadRequestException(
        'This phone number is already registered to an account. Please sign in instead.',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // 🧑 Create user
    const user = await this.prisma.user.create({
      data: {
        firstName,
        lastName,
        password: hashedPassword,
      },
    });

    // 📱 Create PRIMARY contact
    const contact = await this.prisma.userContact.create({
      data: {
        userId: user.id,
        type,
        value: identifier,
        isPrimary: true,
        isVerified: false,
      },
    });

    // 🔐 Send OTP
    await this.otpService.sendOtp(contact.id);

    this.logger.log(`User created: ${user.id}`);

    // 🚨 DO NOT ISSUE FULL ACCESS YET (STRICT)
    return {
      message: 'OTP sent. Please verify to activate account.',
      contactId: contact.id,
    };
  }

  // =====================================================
  // ✅ VERIFY OTP (ACTIVATE ACCOUNT)
  // =====================================================
  async verifyOtp(dto: VerifyDto) {
    const normalizedIdentifier = this.normalizeIdentifier(dto.identifier);
    const { code } = dto;

    const contact = await this.prisma.userContact.findFirst({
      where: { value: normalizedIdentifier },
      include: {
        user: {
          select: {
            firstName: true,
          },
        },
      },
    });

    if (!contact) {
      throw new BadRequestException('Contact not found');
    }

    if (contact.isVerified) {
      const role = await this.getUserRole(contact.userId);
      const tokens = await generateTokens(
        this.jwtService,
        contact.userId,
        contact.value,
        role,
      );

      await this.storeRefreshToken(contact.userId, tokens.refreshToken);

      return {
        message: 'Account already verified',
        ...tokens,
      };
    }

    // 🔐 Validate OTP
    await this.otpService.verifyOtp(contact.id, code);

    // ✅ Mark verified
    await this.prisma.userContact.update({
      where: { id: contact.id },
      data: { isVerified: true },
    });

    this.logger.log(`Contact verified: ${contact.value}`);

    // 🎟 Issue tokens AFTER verification
    const role = await this.getUserRole(contact.userId);
    const tokens = await generateTokens(
      this.jwtService,
      contact.userId,
      contact.value,
      role,
    );

    await this.storeRefreshToken(contact.userId, tokens.refreshToken);

    if (contact.type === 'EMAIL') {
      try {
        await this.emailService.sendWelcomeEmail({
          to: contact.value,
          firstName: contact.user.firstName,
        });
      } catch (error) {
        this.logger.warn(
          `Welcome email failed for ${contact.value}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      message: 'Account verified successfully',
      ...tokens,
    };
  }

  async resendVerificationOtp(identifier: string) {
    const normalizedIdentifier = this.normalizeIdentifier(identifier);

    const contact = await this.prisma.userContact.findFirst({
      where: {
        value: normalizedIdentifier,
      },
    });

    if (!contact) {
      throw new BadRequestException('Account not found');
    }

    if (contact.isVerified) {
      throw new BadRequestException('This account is already verified');
    }

    await this.otpService.sendOtp(contact.id);

    return {
      message: 'Verification code sent',
    };
  }

  // =====================================================
  // 🔑 LOGIN (STRICT VERIFICATION REQUIRED)
  // =====================================================
  async login(dto: LoginDto) {
    const identifier = this.normalizeIdentifier(dto.identifier);
    const { password } = dto;

    const contact = await this.prisma.userContact.findFirst({
      where: { value: identifier },
      include: { user: true },
    });

    if (!contact || !contact.user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 🚨 MUST BE VERIFIED
    if (!contact.isVerified) {
      throw new UnauthorizedException(
        'Account not verified. Please verify OTP first.',
      );
    }

    // Account was created via Google OAuth — no password set
    if (!contact.user.password) {
      throw new UnauthorizedException(
        'This account uses Google sign-in. Please continue with Google.',
      );
    }

    const isMatch = await bcrypt.compare(
      password,
      contact.user.password,
    );

    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await generateTokens(
      this.jwtService,
      contact.user.id,
      identifier,
      contact.user.role,
    );
    await this.storeRefreshToken(contact.user.id, tokens.refreshToken);

    return tokens;
  }

  // =====================================================
  // 🔁 ADD NEW CONTACT (AFTER LOGIN ONLY)
  // =====================================================
  async addContact(userId: string, identifier: string) {
    const normalizedIdentifier = this.normalizeIdentifier(identifier);

    const existing = await this.prisma.userContact.findFirst({
      where: { value: normalizedIdentifier },
    });

    if (existing) {
      throw new BadRequestException(
        'Contact already exists in system',
      );
    }

    const type = normalizedIdentifier.includes('@') ? 'EMAIL' : 'PHONE';

    const contact = await this.prisma.userContact.create({
      data: {
        userId,
        type,
        value: normalizedIdentifier,
        isPrimary: false,
        isVerified: false,
      },
    });

    // 🔐 Send OTP
    await this.otpService.sendOtp(contact.id);

    return {
      message: 'Verification OTP sent to new contact',
      contactId: contact.id,
    };
  }

  // =====================================================
  // ⭐ SET PRIMARY CONTACT
  // =====================================================
  async setPrimary(userId: string, contactId: string) {
    const contact = await this.prisma.userContact.findFirst({
      where: { id: contactId, userId },
    });

    if (!contact || !contact.isVerified) {
      throw new BadRequestException('Invalid contact');
    }

    await this.prisma.userContact.updateMany({
      where: { userId },
      data: { isPrimary: false },
    });

    await this.prisma.userContact.update({
      where: { id: contactId },
      data: { isPrimary: true },
    });

    return { message: 'Primary contact updated' };
  }

  // =====================================================
  // 🌐 GOOGLE LOGIN
  // =====================================================
  async googleLogin(token: string) {
    const googleUser = await this.googleAuth.verifyGoogleToken(token);

    const email = googleUser.email.toLowerCase();
    let authFlow: 'created' | 'linked' | 'signin' = 'signin';

    const existingContact = await this.prisma.userContact.findUnique({
      where: { value: email },
      include: { user: true },
    });

    let user = existingContact?.user ?? null;

    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { googleId: googleUser.googleId },
      });
    }

    if (user && user.googleId && user.googleId !== googleUser.googleId) {
      throw new UnauthorizedException(
        'This email is already linked to a different Google account.',
      );
    }

    if (!user) {
      authFlow = 'created';
      user = await this.prisma.user.create({
        data: {
          firstName: googleUser.firstName || 'Google',
          lastName: googleUser.lastName || 'User',
          googleId: googleUser.googleId,
          profilePicture: googleUser.picture,
          contacts: {
            create: {
              type: 'EMAIL',
              value: email,
              isPrimary: true,
              isVerified: true,
            },
          },
        },
      });
    } else {
      authFlow = user.googleId ? 'signin' : 'linked';
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: googleUser.googleId,
          profilePicture: user.profilePicture || googleUser.picture,
          firstName: user.firstName || googleUser.firstName || 'Google',
          lastName: user.lastName || googleUser.lastName || 'User',
        },
      });

      if (existingContact) {
        if (!existingContact.isVerified || !existingContact.isPrimary) {
          await this.prisma.userContact.update({
            where: { id: existingContact.id },
            data: {
              isVerified: true,
              isPrimary: true,
            },
          });
        }
      } else {
        await this.prisma.userContact.updateMany({
          where: { userId: user.id, type: 'EMAIL' },
          data: { isPrimary: false },
        });

        await this.prisma.userContact.create({
          data: {
            userId: user.id,
            type: 'EMAIL',
            value: email,
            isPrimary: true,
            isVerified: true,
          },
        });
      }
    }

    const tokens = await generateTokens(
      this.jwtService,
      user.id,
      email,
      user.role,
    );
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    try {
      if (authFlow === 'created') {
        await this.emailService.sendWelcomeEmail({
          to: email,
          firstName: user.firstName,
        });
      } else if (authFlow === 'linked') {
        await this.emailService.sendGoogleLinkedEmail({
          to: email,
          firstName: user.firstName,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Post-Google email failed for ${email}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      ...tokens,
      authFlow,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  // =====================================================
  // 🔁 REFRESH TOKENS
  // =====================================================
  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Access denied');
    }

    const isMatch = await bcrypt.compare(
      refreshToken,
      user.refreshToken,
    );

    if (!isMatch) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const identifier = await this.getTokenIdentifier(user.id, userId);
    const tokens = await generateTokens(
      this.jwtService,
      user.id,
      identifier,
      user.role,
    );

    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  // =====================================================
  // 🚪 LOGOUT
  // =====================================================
  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    return { message: 'Logged out successfully' };
  }
}
