/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';
import { MerchantService } from './merchant.service.js';
import { ApplyMerchantDto } from './dto/apply-merchant.dto.js';

interface AuthRequest extends Request {
  user: {
    userId: string;
    email: string;
  };
}

@ApiTags('Merchant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('merchant')
export class MerchantController {
  constructor(private readonly merchant: MerchantService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my merchant profile/application status' })
  getMyProfile(@Req() req: AuthRequest) {
    return this.merchant.getMyProfile(req.user.userId);
  }

  @Post('apply')
  @ApiOperation({ summary: 'Apply to become a merchant (or resubmit after rejection)' })
  apply(@Req() req: AuthRequest, @Body() dto: ApplyMerchantDto) {
    return this.merchant.apply(req.user.userId, dto);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get analytics for payments received by my merchant account' })
  @ApiQuery({ name: 'period', required: false, enum: ['7d', '30d', '90d'] })
  getAnalytics(@Req() req: AuthRequest, @Query('period') period?: '7d' | '30d' | '90d') {
    return this.merchant.getAnalytics(req.user.userId, period);
  }
}
