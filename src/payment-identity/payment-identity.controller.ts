/* eslint-disable prettier/prettier */
import {
  Controller,
  Post,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';

import { PaymentIdentityService } from './payment-identity.service.js';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';

@ApiTags('Payment Identity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payment-identity')
export class PaymentIdentityController {
  constructor(private readonly service: PaymentIdentityService) {}

  // ============================
  // CREATE HANDLE (AUTO)
  // ============================
  @Post()
  @ApiOperation({ summary: 'Create payment identity (auto handle)' })
  create(@Req() req) {
    return this.service.create(req.user.userId);
  }

  // ============================
  // GET MY HANDLE
  // ============================
  @Get('me')
  @ApiOperation({ summary: 'Get my payment identity' })
  me(@Req() req) {
    return this.service.getMyIdentity(req.user.userId);
  }
}