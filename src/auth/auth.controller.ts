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

import type { Request, Response } from 'express';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // =========================
  // 📝 SIGNUP
  // =========================
  @Post('signup')
  @ApiOperation({ summary: 'Create a new user account' })
  @ApiBody({ type: SignupDto })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  // =========================
  // 🔁 RESEND OTP
  // =========================
  @Post('resend-otp')
  @ApiOperation({ summary: 'Resend OTP code' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          example: '670000321',
        },
      },
      required: ['identifier'],
    },
  })
  resendOtp(@Body('identifier') identifier: string) {
    return this.authService.resendOtp(identifier);
  }

  // =========================
  // ✅ VERIFY OTP
  // =========================
  @Post('verify')
  @ApiOperation({ summary: 'Verify OTP code' })
  @ApiBody({ type: VerifyDto })
  verify(@Body() dto: VerifyDto) {
    return this.authService.verifyOtp(dto);
  }

  // =========================
  // 🔐 LOGIN
  // =========================
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiBody({ type: LoginDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto);

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: true, // set false in development
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
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with Google' })
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
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          example: 'user-id-here',
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
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          example: 'user-id-here',
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