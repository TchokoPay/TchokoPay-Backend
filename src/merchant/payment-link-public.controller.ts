/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { MerchantPaymentLinkService } from './merchant-payment-link.service.js';

@ApiTags('Payment Links (Public)')
@Controller('payment-links')
export class PaymentLinkPublicController {
  constructor(private readonly service: MerchantPaymentLinkService) {}

  @Public()
  @Get('public/:slug')
  @ApiOperation({ summary: 'Public details for a payment link (checkout page)' })
  getPublic(@Param('slug') slug: string) {
    return this.service.getPublicLink(slug);
  }

  @Public()
  @Post('public/:slug/checkout')
  @ApiOperation({ summary: 'Start a payment from a link — creates the invoice to pay' })
  checkout(
    @Param('slug') slug: string,
    @Body() body: { payerName?: string; payerEmail?: string },
  ) {
    return this.service.createInvoiceFromLink(slug, body?.payerName, body?.payerEmail);
  }
}
