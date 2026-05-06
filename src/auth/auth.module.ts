/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { GoogleModule } from '../google/google.module.js';
import { OtpModule } from '../otp/otp.module.js';
import { EmailModule } from '../email/email.module.js';

import { JwtStrategy } from './strategies/jwt.strategy.js';
import { JwtAuthGuard } from './guards/jwt.guard.js';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: '15m' },
    }),
    GoogleModule,
    OtpModule,
    EmailModule,
  ],
  providers: [
    AuthService,
    JwtStrategy, // ✅ VERY IMPORTANT
    JwtAuthGuard, // ✅ Guard provider
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtModule], // ✅ allow reuse in other modules
})
export class AuthModule {}
