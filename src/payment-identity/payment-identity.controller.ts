/* eslint-disable prettier/prettier */
import {
  Controller,
  Post,
  Get,
  Req,
  UseGuards,
  Param,
} from '@nestjs/common';

import { PaymentIdentityService } from './payment-identity.service.js';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';
import { Public } from '../auth/decorators/public.decorator.js';

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

  @Public()
  @Get('public/:handle')
  @ApiOperation({ summary: 'Get public checkout details for a payment handle' })
  publicHandle(@Param('handle') handle: string) {
    return this.service.getPublicCheckout(handle);
  }
}
