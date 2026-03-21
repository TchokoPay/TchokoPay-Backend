import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Req,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiBody,
} from '@nestjs/swagger';

import { AuthService } from './auth.service.js';

import { SignupDto } from './dto/signup.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyDto } from './dto/verify.dto.js';

import { Public } from './decorators/public.decorator.js';

import type { Request, Response } from 'express';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // =========================
  // 📝 SIGNUP (OTP REQUIRED)
  // =========================
  @Public()
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
  @Post('verify')
  @ApiOperation({
    summary:
      'Verify OTP to activate account and get access token',
  })
  @ApiBody({ type: VerifyDto })
  async verify(@Body() dto: VerifyDto) {
    return this.authService.verifyOtp(dto);
  }

  // =========================
  // 🔐 LOGIN (ONLY VERIFIED USERS)
  // =========================
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Login with verified email or phone',
  })
  @ApiBody({ type: LoginDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto);

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: true, // set false in dev
      sameSite: 'strict',
      path: '/auth/refresh',
    });

    return {
      accessToken: tokens.accessToken,
    };
  }

  // =========================
  // 🌐 GOOGLE LOGIN
  // =========================
  @Public()
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
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.googleLogin(token);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/auth/refresh',
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
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          example: 'user-id',
        },
      },
      required: ['userId'],
    },
  })
  async refresh(
    @Body('userId') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken || !userId) {
      throw new Error('Unauthorized');
    }

    const tokens = await this.authService.refreshTokens(
      userId,
      refreshToken,
    );

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/auth/refresh',
    });

    return {
      accessToken: tokens.accessToken,
    };
  }

  // =========================
  // 🚪 LOGOUT
  // =========================
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout user',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          example: 'user-id',
        },
      },
      required: ['userId'],
    },
  })
  async logout(
    @Body('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(userId);

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    return {
      message: 'Logged out successfully',
    };
  }
}