/* eslint-disable prettier/prettier */
import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';
import { MerchantService } from './merchant.service.js';
import { MerchantPaymentLinkService } from './merchant-payment-link.service.js';
import { MerchantCashoutService } from './merchant-cashout.service.js';
import { ApplyMerchantDto } from './dto/apply-merchant.dto.js';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto.js';
import { CreateEventDto } from './dto/create-event.dto.js';

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
  constructor(
    private readonly merchant: MerchantService,
    private readonly paymentLinks: MerchantPaymentLinkService,
    private readonly cashouts: MerchantCashoutService,
  ) {}

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

  @Get('wallet')
  @ApiOperation({ summary: 'Get my merchant wallet balance (held funds for cash-out)' })
  getWallet(@Req() req: AuthRequest) {
    return this.merchant.getWallet(req.user.userId);
  }

  // ── Cash-out ───────────────────────────────────────────────────────────────

  @Get('cashout/quote')
  @ApiOperation({ summary: 'Available balance + withdrawal fee + payout destination' })
  quoteCashout(@Req() req: AuthRequest) {
    return this.cashouts.quoteCashout(req.user.userId);
  }

  @Post('cashout')
  @ApiOperation({ summary: 'Request a cash-out of held wallet funds (admin-approved)' })
  requestCashout(@Req() req: AuthRequest, @Body() body: { amount: number }) {
    return this.cashouts.requestCashout(req.user.userId, Number(body?.amount));
  }

  @Get('cashouts')
  @ApiOperation({ summary: 'My cash-out request history' })
  listCashouts(@Req() req: AuthRequest) {
    return this.cashouts.listMyCashouts(req.user.userId);
  }

  @Get('handle')
  @ApiOperation({ summary: 'Get my business storefront handle + payout' })
  getMyHandle(@Req() req: AuthRequest) {
    return this.merchant.getMyHandle(req.user.userId);
  }

  @Post('handle')
  @ApiOperation({ summary: 'Create my business storefront handle (inherit or pick a verified payout)' })
  createHandle(@Req() req: AuthRequest, @Body() body: { payoutSettingId?: string }) {
    return this.merchant.createHandle(req.user.userId, body?.payoutSettingId);
  }

  @Patch('handle/payout')
  @ApiOperation({ summary: 'Change which payout number my business handle settles to' })
  updateHandlePayout(@Req() req: AuthRequest, @Body() body: { payoutSettingId: string }) {
    return this.merchant.updateHandlePayout(req.user.userId, body.payoutSettingId);
  }

  // ── Payment links ──────────────────────────────────────────────────────────

  @Get('payment-links')
  @ApiOperation({ summary: 'List my payment-collection links' })
  listPaymentLinks(@Req() req: AuthRequest) {
    return this.paymentLinks.list(req.user.userId, 'LINK');
  }

  @Post('payment-links')
  @ApiOperation({ summary: 'Create a payment-collection link' })
  createPaymentLink(@Req() req: AuthRequest, @Body() dto: CreatePaymentLinkDto) {
    return this.paymentLinks.create(req.user.userId, dto);
  }

  @Get('payment-links/:id')
  @ApiOperation({ summary: 'Get one of my payment links' })
  getPaymentLink(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.paymentLinks.getOne(req.user.userId, id);
  }

  @Get('payment-links/:id/payments')
  @ApiOperation({ summary: 'List payers/payments for one of my links' })
  getPaymentLinkPayments(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.paymentLinks.getPayments(req.user.userId, id);
  }

  @Patch('payment-links/:id/active')
  @ApiOperation({ summary: 'Activate or deactivate a payment link' })
  setPaymentLinkActive(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.paymentLinks.setActive(req.user.userId, id, body.isActive);
  }

  // ── Events ───────────────────────────────────────────────────────────────

  @Get('events')
  @ApiOperation({ summary: 'List my events' })
  listEvents(@Req() req: AuthRequest) {
    return this.paymentLinks.list(req.user.userId, 'EVENT');
  }

  @Post('events')
  @ApiOperation({ summary: 'Create an event' })
  createEvent(@Req() req: AuthRequest, @Body() dto: CreateEventDto) {
    return this.paymentLinks.createEvent(req.user.userId, dto);
  }

  @Get('events/:id/payments')
  @ApiOperation({ summary: 'List attendees/registrations for one of my events' })
  getEventAttendees(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.paymentLinks.getPayments(req.user.userId, id);
  }

  @Patch('events/:id/active')
  @ApiOperation({ summary: 'Activate or deactivate an event' })
  setEventActive(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.paymentLinks.setActive(req.user.userId, id, body.isActive);
  }

  @Post('events/image')
  @ApiOperation({ summary: 'Upload an event image (cover or logo) — returns its URL' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 4 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Only JPG, PNG, WEBP allowed'), ok);
      },
    }),
  )
  uploadEventImage(
    @Req() req: AuthRequest,
    @UploadedFile() file: Express.Multer.File,
    @Query('kind') kind?: 'cover' | 'logo',
  ) {
    return this.paymentLinks.uploadImage(req.user.userId, file, kind === 'logo' ? 'logo' : 'cover');
  }

  @Patch('events/:id/email')
  @ApiOperation({ summary: 'Customize the post-payment confirmation email for an event' })
  updateEventEmail(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { subject?: string; message?: string; attachmentUrl?: string | null; attachmentName?: string | null },
  ) {
    return this.paymentLinks.updateConfirmEmail(req.user.userId, id, body);
  }

  @Post('events/attachment')
  @ApiOperation({ summary: 'Upload an attachment (e.g. ticket/receipt) for the event email' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Only PDF, JPG, PNG, WEBP allowed'), ok);
      },
    }),
  )
  uploadEventAttachment(@Req() req: AuthRequest, @UploadedFile() file: Express.Multer.File) {
    return this.paymentLinks.uploadAttachment(req.user.userId, file);
  }
}
