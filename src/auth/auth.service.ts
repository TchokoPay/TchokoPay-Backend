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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private googleAuth: GoogleAuthService,
    private otpService: OtpService,
  ) {}

  // =====================================================
  // 🚀 SIGNUP (STRICT INDUSTRY STANDARD)
  // =====================================================
  async signup(dto: SignupDto) {
    const { email, phone, password, firstName, lastName } = dto;

    // ✅ Must provide exactly ONE identifier
    if ((email && phone) || (!email && !phone)) {
      throw new BadRequestException(
        'Provide either email OR phone (not both)',
      );
    }

    const identifier = email || phone;
    const type = email ? 'EMAIL' : 'PHONE';

    this.logger.log(`Signup attempt: ${identifier}`);

    // 🚨 GLOBAL UNIQUENESS CHECK
    const existingContact = await this.prisma.userContact.findFirst({
      where: { value: identifier },
    });

    if (existingContact) {
      throw new BadRequestException(
        'Email or phone already in use',
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
    const { identifier, code } = dto;

    const contact = await this.prisma.userContact.findFirst({
      where: { value: identifier },
    });

    if (!contact) {
      throw new BadRequestException('Contact not found');
    }

    if (contact.isVerified) {
      return { message: 'Already verified' };
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
    const tokens = await generateTokens(
      this.jwtService,
      contact.userId,
      contact.value,
    );

    return {
      message: 'Account verified successfully',
      ...tokens,
    };
  }

  // =====================================================
  // 🔑 LOGIN (STRICT VERIFICATION REQUIRED)
  // =====================================================
  async login(dto: LoginDto) {
    const { identifier, password } = dto;

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
    );

    const hashedRefreshToken = await bcrypt.hash(
      tokens.refreshToken,
      10,
    );

    await this.prisma.user.update({
      where: { id: contact.user.id },
      data: { refreshToken: hashedRefreshToken },
    });

    return tokens;
  }

  // =====================================================
  // 🔁 ADD NEW CONTACT (AFTER LOGIN ONLY)
  // =====================================================
  async addContact(userId: string, identifier: string) {
    const existing = await this.prisma.userContact.findFirst({
      where: { value: identifier },
    });

    if (existing) {
      throw new BadRequestException(
        'Contact already exists in system',
      );
    }

    const type = identifier.includes('@') ? 'EMAIL' : 'PHONE';

    const contact = await this.prisma.userContact.create({
      data: {
        userId,
        type,
        value: identifier,
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

    let user = await this.prisma.user.findUnique({
      where: { googleId: googleUser.googleId },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          firstName: googleUser.firstName || 'Google',
          lastName: googleUser.lastName || 'User',
          googleId: googleUser.googleId,
        },
      });
    }

    const tokens = await generateTokens(
      this.jwtService,
      user.id,
      googleUser.email!,
    );

    const hashedRefreshToken = await bcrypt.hash(
      tokens.refreshToken,
      10,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefreshToken },
    });

    return {
      ...tokens,
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

    const tokens = await generateTokens(
      this.jwtService,
      user.id,
      userId,
    );

    const hashedRefreshToken = await bcrypt.hash(
      tokens.refreshToken,
      10,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefreshToken },
    });

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