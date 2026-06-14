import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiBody,
} from '@nestjs/swagger';

import { Throttle, SkipThrottle } from '@nestjs/throttler';

import { AuthService } from './auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionsService } from './sessions/sessions.service.js';

import { SignupDto } from './dto/signup.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyDto } from './dto/verify.dto.js';

import { Public } from './decorators/public.decorator.js';
import { parseJwtPayload } from './utils/tokens.js';

import type { Request, Response } from 'express';
import type { CookieOptions } from 'express';

const isProduction = process.env.NODE_ENV === 'production';
const refreshCookieLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function parseSameSite(value?: string): CookieOptions['sameSite'] {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'strict') return 'strict';
  if (normalized === 'lax') return 'lax';
  if (normalized === 'none') return 'none';

  return isProduction ? 'strict' : 'lax';
}

function refreshCookieOptions(): CookieOptions {
  const sameSite = parseSameSite(process.env.AUTH_COOKIE_SAME_SITE);
  const secure = sameSite === 'none' ? true : isProduction;
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;

  return {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: '/auth/refresh',
    maxAge: refreshCookieLifetimeMs,
  };
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private audit: AuditService,
    private sessions: SessionsService,
  ) {}

  @Public()
  @Get('google/config')
  @ApiOperation({
    summary: 'Get Google auth client configuration for the frontend',
  })
  getGoogleConfig() {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;

    return {
      enabled: Boolean(clientId),
      clientId,
    };
  }

  // =========================
  // 📝 SIGNUP (OTP REQUIRED)
  // =========================
  @Public()
  @SkipThrottle({ global: true })
  @Throttle({ auth: { limit: 15, ttl: 60_000 } })
  @Post('signup')
  @ApiOperation({
    summary:
      'Signup with email OR phone. OTP required before login.',
  })
  @ApiBody({ type: SignupDto })
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  // =========================
  // ✅ VERIFY OTP (ACTIVATION)
  // =========================
  @Public()
  @SkipThrottle({ global: true })
  @Throttle({ auth: { limit: 10, ttl: 300_000 } })
  @Post('verify')
  @ApiOperation({
    summary:
      'Verify OTP to activate account and get access token',
  })
  @ApiBody({ type: VerifyDto })
  async verify(
    @Body() dto: VerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.verifyOtp(dto);

    res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions());

    return {
      message: tokens.message,
      accessToken: tokens.accessToken,
    };
  }

  @Public()
  @SkipThrottle({ global: true })
  @Throttle({ auth: { limit: 5, ttl: 300_000 } })
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend account verification OTP',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          example: 'you@example.com',
        },
      },
      required: ['identifier'],
    },
  })
  async resendVerification(@Body('identifier') identifier: string) {
    return this.authService.resendVerificationOtp(identifier);
  }

  // =========================
  // 🔐 LOGIN (ONLY VERIFIED USERS)
  // =========================
  @Public()
  @SkipThrottle({ global: true })
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Login with verified email or phone',
  })
  @ApiBody({ type: LoginDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto);

    res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions());

    const payload = parseJwtPayload(tokens.accessToken);
    const userId = payload?.sub as string | undefined;
    const deviceHash = req.headers['x-device-hash'] as string | undefined;

    this.audit.log({
      userId,
      action: 'USER_LOGIN',
      entity: 'User',
      entityId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.sessions.trackLogin({
      userId: userId!,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string,
      deviceHash,
    });

    return {
      accessToken: tokens.accessToken,
    };
  }

  // =========================
  // 🌐 GOOGLE LOGIN
  // =========================
  @Public()
  @SkipThrottle({ global: true })
  @Throttle({ auth: { limit: 15, ttl: 60_000 } })
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with Google',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          example: 'GOOGLE_ID_TOKEN',
        },
      },
      required: ['token'],
    },
  })
  async googleLogin(
    @Body('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.googleLogin(token);

    res.cookie('refreshToken', result.refreshToken, refreshCookieOptions());

    const payload = parseJwtPayload(result.accessToken);
    const userId = payload?.sub as string | undefined;
    this.sessions.trackLogin({
      userId: userId!,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string,
      deviceHash: req.headers['x-device-hash'] as string | undefined,
    });

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  // =========================
  // 🔁 REFRESH TOKEN
  // =========================
  @Public()
  @SkipThrottle({ global: true })
  @Throttle({ auth: { limit: 40, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token using the httpOnly refreshToken cookie',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Unauthorized');
    }

    // userId is extracted from the JWT payload — not trusted from the body
    const tokens = await this.authService.refreshTokensFromCookie(refreshToken);

    res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions());

    return {
      accessToken: tokens.accessToken,
    };
  }

  // =========================
  // 🔑 ADMIN BOOTSTRAP (one-time, token-gated)
  // =========================
  @Public()
  @Post('admin/bootstrap')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Promote first admin (requires ADMIN_BOOTSTRAP_TOKEN env var)' })
  bootstrap(
    @Body('email') email: string,
    @Body('bootstrapToken') bootstrapToken: string,
  ) {
    return this.authService.bootstrapAdmin(email, bootstrapToken);
  }

  // =========================
  // 🚪 LOGOUT
  // =========================
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout current user',
  })
  async logout(
    @Req() req: Request & { user?: { userId?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = req.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Unauthorized');
    }

    await this.authService.logout(userId);

    res.clearCookie('refreshToken', refreshCookieOptions());

    this.audit.log({
      userId,
      action: 'USER_LOGOUT',
      entity: 'User',
      entityId: userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'] as string | undefined,
    });

    return {
      message: 'Logged out successfully',
    };
  }
}
