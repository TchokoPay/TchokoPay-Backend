/* eslint-disable prettier/prettier */
import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Param,
  UseGuards,
  Headers,
  Query,
} from '@nestjs/common';

import { PaymentService } from './payment.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard.js';
import { Public } from '../auth/decorators/public.decorator.js';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  // ============================
  // PROCESS PAYMENT (FLOW-BASED)
  // Supports both authenticated users and guests.
  // @Public()       → bypasses the global JwtAuthGuard
  // OptionalJwtGuard → extracts userId if JWT present; sets req.user = null for guests
  // ============================
  @Post()
  @Public()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({
    summary: 'Process payment (DIRECT, QR, REQUEST)',
    description: `
    Handles different payment flows:

    **DIRECT Flow** - Pay to phone number:
    \`\`\`json
    {
      "flow": "DIRECT",
      "amount": 5000,
      "amountType": "PAY",
      "baseCurrency": "XAF",
      "targetCurrency": "XAF",
      "paymentMethod": "MOMO",
      "payoutMethod": "MOMO",
      "recipientPhone": "670000000",
      "description": "Direct payment"
    }
    \`\`\`

    **QR Flow** - Pay to handle:
    \`\`\`json
    {
      "flow": "QR",
      "amount": 0.0001,
      "amountType": "PAY",
      "baseCurrency": "BTC",
      "targetCurrency": "XAF",
      "paymentMethod": "LIGHTNING",
      "payoutMethod": "MOMO",
      "recipientHandle": "@tchoko-brian",
      "description": "QR payment"
    }
    \`\`\`

    **REQUEST CREATE** - Create payment request:
    \`\`\`json
    {
      "flow": "REQUEST",
      "action": "CREATE",
      "amount": 5000,
      "amountType": "PAY",
      "targetCurrency": "XAF",
      "payoutMethod": "MOMO",
      "description": "Shoes payment"
    }
    \`\`\`

    **REQUEST PAY** - Pay existing request:
    \`\`\`json
    {
      "flow": "REQUEST",
      "action": "PAY",
      "invoiceReference": "REQ-1774408197902",
      "baseCurrency": "BTC",
      "paymentMethod": "Lightning"
    }
    \`\`\`
    Note: Amount is NOT needed - it's already specified in the invoice.
    `,
  })
  @ApiBody({
    type: CreatePaymentDto,
    description: 'Payment request payload - choose example below that matches your use case',
    examples: {
      'DIRECT_LIGHTNING_to_MOMO_registered': {
        summary: 'DIRECT: Registered user pays via LIGHTNING → recipient gets MOMO (XAF)',
        description: 'Registered user with Lightning wallet sends payment to recipient (phone lookup → MOMO payout). No payerPhone needed (wallet on file).',
        value: {
          flow: 'DIRECT',
          amount: 0.0001,
          amountType: 'PAY',
          baseCurrency: 'BTC',
          targetCurrency: 'XAF',
          paymentMethod: 'LIGHTNING',
          payoutMethod: 'MOMO',
          recipientPhone: '670654321',
          description: 'Payment for services',
        },
      },
      'DIRECT_MOMO_to_MOMO_guest': {
        summary: 'DIRECT: Guest user pays via MOMO → recipient gets MOMO (requires payerPhone)',
        description: 'Unregistered guest user (not logged in) sends MOMO to another phone. Both payer & recipient identified by phone numbers only.',
        value: {
          flow: 'DIRECT',
          amount: 5000,
          amountType: 'PAY',
          baseCurrency: 'XAF',
          targetCurrency: 'XAF',
          paymentMethod: 'MOMO',
          payoutMethod: 'MOMO',
          recipientPhone: '670000000',
          payerPhone: '670111111',
          description: 'Direct mobile money transfer',
        },
      },
      'DIRECT_MOMO_user_no_verified_phone': {
        summary: 'DIRECT: Registered MOMO user without verified phone (requires payerPhone field)',
        description: 'Account exists but phone not verified. payerPhone bypasses verification to proceed with mobile money.',
        value: {
          flow: 'DIRECT',
          amount: 2500,
          amountType: 'RECEIVE',
          baseCurrency: 'XAF',
          targetCurrency: 'XAF',
          paymentMethod: 'MOMO',
          payoutMethod: 'MOMO',
          recipientPhone: '670000000',
          payerPhone: '670123456',
          description: 'Sending via MOMO with phone verification',
        },
      },
      'QR_LIGHTNING_registered': {
        summary: 'QR: Registered user with LIGHTNING wallet pays to @handle via MOMO',
        description: 'Pay to registered user handle (@username). System resolves recipient and sends payment via their verified MOMO phone. Note: payoutMethod is forced to MOMO for now.',
        value: {
          flow: 'QR',
          amount: 0.0001,
          amountType: 'PAY',
          baseCurrency: 'BTC',
          targetCurrency: 'XAF',
          paymentMethod: 'LIGHTNING',
          recipientHandle: '@tchoko-brian',
          description: 'QR code payment - recipient gets MOMO',
        },
      },
      'QR_MOMO_guest_to_handle': {
        summary: 'QR: Guest MOMO user pays to @handle via recipient\'s MOMO (requires payerPhone)',
        description: 'Unregistered guest identified by phone pays to registered user handle. Recipient receives payment via their verified MOMO phone (payoutMethod always MOMO for QR).',
        value: {
          flow: 'QR',
          amount: 2500,
          amountType: 'PAY',
          baseCurrency: 'XAF',
          targetCurrency: 'XAF',
          paymentMethod: 'MOMO',
          recipientHandle: '@tchoko-alice',
          payerPhone: '670222222',
          description: 'QR mobile money payment - recipient gets MOMO',
        },
      },
      'REQUEST_CREATE_quote_only': {
        summary: 'REQUEST CREATE: Recipient creates invoice → system returns quote only (early return)',
        description: 'Recipient initiates payment request. Response includes quote with exchangeRate, fee, expiresAt. No payment processed yet.',
        value: {
          flow: 'REQUEST',
          action: 'CREATE',
          amount: 5000,
          amountType: 'PAY',
          targetCurrency: 'XAF',
          paymentMethod: 'MOMO',
          payoutMethod: 'MOMO',
          description: 'Invoice for shoes - valid for 1 hour',
        },
      },
      'REQUEST_CREATE_crypto_invoice': {
        summary: 'REQUEST CREATE: Recipient creates crypto invoice for later payment',
        description: 'Recipient requests payment in SAT (satoshis). Quote will show BTC/SAT exchange rate.',
        value: {
          flow: 'REQUEST',
          action: 'CREATE',
          amount: 50000,
          amountType: 'RECEIVE',
          targetCurrency: 'SAT',
          payoutMethod: 'CRYPTO',
          description: 'Invoice for 50K satoshis - valid 1 day',
        },
      },
      'REQUEST_PAY_LIGHTNING_registered': {
        summary: 'REQUEST PAY: Registered user pays LIGHTNING invoice by reference (registered user)',
        description: 'Payer has LIGHTNING wallet. System looks up invoice by branded reference (INV-* or REQ-*) and processes payment.',
        value: {
          flow: 'REQUEST',
          action: 'PAY',
          invoiceReference: 'INV-1774406561780',
          baseCurrency: 'BTC',
          paymentMethod: 'LIGHTNING',
          description: 'Paying invoice',
        },
      },
      'REQUEST_PAY_SAT_registered': {
        summary: 'REQUEST PAY: Registered LIGHTNING user pays in SAT (satoshis) for micro-payments',
        description: 'For small Lightning payments, use SAT instead of BTC. 1 SAT = 1/100M BTC.',
        value: {
          flow: 'REQUEST',
          action: 'PAY',
          invoiceReference: 'REQ-1774408197902',
          baseCurrency: 'SAT',
          paymentMethod: 'LIGHTNING',
          description: 'Paying in satoshis',
        },
      },
      'REQUEST_PAY_MOMO_guest': {
        summary: 'REQUEST PAY: Guest MOMO user pays invoice (requires payerPhone)',
        description: 'Unregistered payer identified by phone pays existing invoice via MOMO.',
        value: {
          flow: 'REQUEST',
          action: 'PAY',
          invoiceReference: 'INV-1774406561780',
          paymentMethod: 'MOMO',
          payerPhone: '670333333',
          description: 'Paying invoice via MOMO',
        },
      },
      'REQUEST_PAY_with_idempotency': {
        summary: 'REQUEST PAY: With idempotency key for retry safety (exactly-once guarantee)',
        description: 'Same idempotencyKey = same response (no duplicate charge). Use UUID v4. Recommended for all critical payments.',
        value: {
          flow: 'REQUEST',
          action: 'PAY',
          invoiceReference: 'REQ-1774408197902',
          baseCurrency: 'BTC',
          paymentMethod: 'LIGHTNING',
          idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
          description: 'Idempotent invoice payment - safe to retry',
        },
      },
      'DIRECT_with_idempotency': {
        summary: 'DIRECT: With idempotency key for network retry protection',
        description: 'Request with unique key. Retry with same key returns previous response without recharging.',
        value: {
          flow: 'DIRECT',
          amount: 0.0001,
          amountType: 'PAY',
          baseCurrency: 'BTC',
          targetCurrency: 'XAF',
          paymentMethod: 'LIGHTNING',
          payoutMethod: 'MOMO',
          recipientPhone: '670654321',
          idempotencyKey: 'abc12345-1234-1234-1234-abcdef123456',
          description: 'Idempotent DIRECT payment',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Payment processed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request / validation error',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async process(
    @Req() req,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Body() dto: CreatePaymentDto,
  ) {
    if (idempotencyKey) {
      dto.idempotencyKey = idempotencyKey;
    }
    // req.user is null for guests; pass empty string so service knows it's a guest
    const userId: string = (req.user as { userId: string } | null)?.userId ?? '';
    return this.service.processPayment(userId, dto);
  }

  // ============================
  // PROVIDER VERIFICATION (DEBUG)
  // ============================
  @Get('verify-providers')
  @ApiOperation({
    summary: 'Verify Netwalletpay provider configuration',
    description: 'Debug endpoint: Query Netwalletpay API to verify supported countries, methods, and providers.',
  })
  @ApiQuery({ name: 'paymentType', required: true, description: 'COLLECTION or PAYOUT', example: 'COLLECTION' })
  @ApiQuery({ name: 'method', required: true, description: 'MOBILE_MONEY, CARD, BANK, CRYPTO, NETWALLET_PAY', example: 'MOBILE_MONEY' })
  @ApiQuery({ name: 'country', required: true, description: 'ISO2 country code', example: 'CM' })
  @ApiResponse({
    status: 200,
    description: 'Provider configuration verified successfully',
    example: {
      status: 'SUCCESS',
      endpoint: '/api/v1/lookup/get-providers/COLLECTION/MOBILE_MONEY/CM',
      paymentType: 'COLLECTION',
      method: 'MOBILE_MONEY',
      country: 'CM',
      providersCount: 4,
      providers: [
        {
          id: 'mtn_cm',
          name: 'MTN Mobile Money',
          transactionCurrency: 'XAF'
        },
        {
          id: 'orange_cm',
          name: 'Orange Mobile Money',
          transactionCurrency: 'XAF'
        }
      ]
    }
  })
  async verifyProviders(
    @Query('paymentType') paymentType: string,
    @Query('method') method: string,
    @Query('country') country: string,
  ) {
    return this.service.verifyProviders(paymentType, method, country);
  }

  // ============================
  // ACTIVE COUNTRIES (Public — read by payment creation wizard)
  // ============================
  @Public()
  @Get('active-countries')
  @ApiOperation({ summary: 'Active countries + providers for the payment wizard (no auth required)' })
  getActiveCountries() {
    return this.service.getActiveCountries();
  }

  // ============================
  // TRANSACTION LIMITS (Public — read by payment wizard for live validation)
  // ============================
  @Public()
  @Get('transaction-limits')
  @ApiOperation({ summary: 'Active transaction limits per currency (no auth required)' })
  getTransactionLimits() {
    return this.service.getTransactionLimits();
  }

  // ============================
  // PUBLIC INVOICE LOOKUP (for /pay/[reference] page — no auth required)
  // ============================
  @Public()
  @Get('invoice/:reference')
  @ApiOperation({
    summary: 'Get invoice by reference (public — used by pay page)',
  })
  @ApiResponse({ status: 200, description: 'Invoice details' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async getInvoice(@Param('reference') reference: string) {
    return this.service.getInvoiceByReference(reference);
  }
}