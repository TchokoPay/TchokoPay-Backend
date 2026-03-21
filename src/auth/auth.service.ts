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

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private googleAuth: GoogleAuthService,
    ) {}

    // =========================
    // 🔐 OTP GENERATION
    // =========================
    private generateOtp(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    private async checkOtpRateLimit(contactId: string) {
        const lastOtp = await this.prisma.verificationCode.findFirst({
            where: { contactId },
            orderBy: { createdAt: 'desc' },
        });

        if (lastOtp) {
            const diff = Date.now() - new Date(lastOtp.createdAt).getTime();

            if (diff < 60 * 1000) {
                this.logger.warn(`OTP rate limit hit for contact: ${contactId}`);
                throw new BadRequestException(
                    'Please wait before requesting another OTP',
                );
            }
        }
    }

    private async sendOtp(contactId: string) {
        await this.checkOtpRateLimit(contactId);

        const code = this.generateOtp();

        this.logger.log(`OTP generated for contact ${contactId}: ${code}`);

        await this.prisma.verificationCode.create({
            data: {
                contactId,
                code,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            },
        });
    }

    // =========================
    // 🚀 SIGNUP
    // =========================
    async signup(dto: SignupDto) {
        const { email, phone, password, firstName, lastName } = dto;

        if (!email && !phone) {
            throw new BadRequestException('Email or phone is required');
        }

        const value = email ?? phone!;

        this.logger.log(`Signup attempt for: ${value}`);

        const existingContact = await this.prisma.userContact.findFirst({
            where: { value },
        });

        if (existingContact) {
            this.logger.warn(`User already exists: ${value}`);
            throw new BadRequestException('User already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const user = await this.prisma.user.create({
            data: {
                firstName,
                lastName,
                password: hashedPassword,
            },
        });

        const contact = await this.prisma.userContact.create({
            data: {
                userId: user.id,
                type: email ? 'EMAIL' : 'PHONE',
                value,
                isPrimary: true,
                isVerified: false,
            },
        });

        await this.sendOtp(contact.id);

        this.logger.log(`User created successfully: ${user.id}`);

        const tokens = await generateTokens(
            this.jwtService,
            user.id,
            value,
        );

        const hashedRefreshToken = await bcrypt.hash(
            tokens.refreshToken,
            10,
        );

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                refreshToken: hashedRefreshToken,
            },
        });

        return {
            ...tokens,
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: email || null,
                phone: phone || null,
            },
        };
    }

    // =========================
    // 🔁 RESEND OTP
    // =========================
    async resendOtp(identifier: string) {
        this.logger.log(`Resend OTP for: ${identifier}`);

        const contact = await this.prisma.userContact.findFirst({
            where: { value: identifier },
        });

        if (!contact) {
            throw new BadRequestException('Contact not found');
        }

        if (contact.isVerified) {
            throw new BadRequestException('Already verified');
        }

        await this.sendOtp(contact.id);

        return { message: 'OTP resent successfully' };
    }

    // =========================
    // ✅ VERIFY OTP
    // =========================
    async verifyOtp(dto: VerifyDto) {
        const { identifier, code } = dto;

        this.logger.log(`OTP verification for: ${identifier}`);

        const contact = await this.prisma.userContact.findFirst({
            where: { value: identifier },
        });

        if (!contact) {
            throw new BadRequestException('Contact not found');
        }

        const otp = await this.prisma.verificationCode.findFirst({
            where: {
                contactId: contact.id,
                code,
            },
            orderBy: { createdAt: 'desc' },
        });

        if (!otp) {
            throw new BadRequestException('Invalid code');
        }

        if (otp.expiresAt < new Date()) {
            throw new BadRequestException('Code expired');
        }

        await this.prisma.userContact.update({
            where: { id: contact.id },
            data: { isVerified: true },
        });

        this.logger.log(`OTP verified successfully: ${identifier}`);

        return { message: 'Verification successful' };
    }

    // =========================
    // 🔑 LOGIN
    // =========================
    async login(dto: LoginDto) {
        const { identifier, password } = dto;

        this.logger.log(`Login attempt: ${identifier}`);

        const contact = await this.prisma.userContact.findFirst({
            where: { value: identifier },
            include: { user: true },
        });

        if (!contact || !contact.user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (!contact.isVerified) {
            throw new UnauthorizedException('Please verify your account');
        }

        const user = contact.user;

        if (!user.password) {
            throw new UnauthorizedException('Invalid account setup');
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const tokens = await generateTokens(
            this.jwtService,
            user.id,
            identifier,
        );

        const hashedRefreshToken = await bcrypt.hash(
            tokens.refreshToken,
            10,
        );

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                refreshToken: hashedRefreshToken,
            },
        });

        this.logger.log(`Login successful: ${user.id}`);

        return tokens;
    }

    // =========================
    // 🌐 GOOGLE LOGIN
    // =========================
    async googleLogin(token: string) {
        this.logger.log(`Google login attempt`);

        const googleUser = await this.googleAuth.verifyGoogleToken(token);

        if (!googleUser.googleId) {
            throw new UnauthorizedException('Invalid Google user');
        }

        let user = await this.prisma.user.findUnique({
            where: { googleId: googleUser.googleId },
        });

        if (!user) {
            this.logger.log(`Creating new Google user: ${googleUser.email}`);

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
            data: {
                refreshToken: hashedRefreshToken,
            },
        });

        this.logger.log(`Google login successful: ${user.id}`);

        return {
            ...tokens,
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: googleUser.email,
                googleId: user.googleId,
            },
        };
    }

    // =========================
    // 🔁 REFRESH TOKEN
    // =========================
    async refreshTokens(userId: string, refreshToken: string) {
        this.logger.log(`Refreshing tokens for user: ${userId}`);

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
            user.id,
        );

        const hashedRefreshToken = await bcrypt.hash(
            tokens.refreshToken,
            10,
        );

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                refreshToken: hashedRefreshToken,
            },
        });

        return tokens;
    }

    // =========================
    // 🚪 LOGOUT
    // =========================
    async logout(userId: string) {
        this.logger.log(`Logout user: ${userId}`);

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                refreshToken: null,
            },
        });

        return { message: 'Logged out successfully' };
    }
}