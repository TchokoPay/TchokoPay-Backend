import { Injectable, BadRequestException } from '@nestjs/common';
import { TransactionStatus } from '@prisma/client';
import { QuoteService } from '../../quote/quote.service.js';
import {
  CreateQuoteDto,
  PaymentMethodEnum,
  FlowEnum,
} from '../../quote/dto/create-quote.dto.js';
import { CreatePaymentDto } from '../dto/create-payment.dto.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PaymentProviderFactory } from '../providers/payment-provider.factory.js';
import { FlowType, PaymentAction } from '../enums/payment.enums.js';
import { PhoneResolutionService } from '../services/phone-resolution.service.js';
import { PaymentEventService } from '../services/payment-event.service.js';
import { PaymentPollingService, PollingProvider } from '../services/payment-polling.service.js';

@Injectable()
export class ProcessPaymentUseCase {
  constructor(
    private quoteService: QuoteService,
    private prisma: PrismaService,
    private providerFactory: PaymentProviderFactory,
    private phoneResolution: PhoneResolutionService,
    private paymentEventService: PaymentEventService,
    private pollingService: PaymentPollingService,
  ) {}

  async execute({ userId, dto }: { userId: string; dto: CreatePaymentDto }) {
    const endpoint = 'payments.process';
    const idempotencyKey = (dto.idempotencyKey || '').trim();
    const isGuest = !userId || !userId.trim();

    console.log('\n' + '='.repeat(80));
    console.log('🚀 PAYMENT PROCESSING STARTED');
    console.log('='.repeat(80));
    console.log('📋 Payment Details:', {
      flow: dto.flow,
      action: dto.action,
      paymentMethod: dto.paymentMethod,
      payoutMethod: dto.payoutMethod,
      amount: dto.amount,
      baseCurrency: dto.baseCurrency,
      targetCurrency: dto.targetCurrency,
      userId,
    });

    if (idempotencyKey) {
      console.log('🔑 Idempotency Key:', idempotencyKey);
      const existingKey = await this.prisma.idempotencyKey.findFirst({
        where: {
          key: idempotencyKey,
          endpoint,
        },
      });

      if (existingKey?.response) {
        console.log('✅ Idempotent response found - returning cached result');
        return existingKey.response;
      }

      if (!existingKey) {
        console.log('📝 Creating new idempotency key');
        await this.prisma.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            endpoint,
            userId,
            request: dto as any,
          },
        });
      }
    }

    this.validatePaymentFlow(dto);

    let quote;

    // ============================
    // 1. REQUEST CREATE: Early return with quote only (no payment processing)
    // ============================
    if (dto.flow === FlowType.REQUEST && dto.action === PaymentAction.CREATE) {
      console.log('📌 Flow: REQUEST CREATE - Creating invoice without payment processing');
      const quotePayload = this.buildQuoteForRequest(dto);
      quote = await this.quoteService.create(quotePayload);

      const result = {
        message: 'Payment request created',
        quote,
      };

      console.log('✅ REQUEST CREATE completed:', { quoteId: quote.id });
      await this.saveIdempotencyResponse(idempotencyKey, endpoint, result);
      return result; // ✅ Early return - no invoice/payment processing
    }

    // ============================
    // 2. REQUEST PAY: Get invoice and process payment
    // ============================
    if (dto.flow === FlowType.REQUEST && dto.action === PaymentAction.PAY) {
      console.log('📌 Flow: REQUEST PAY - Processing payment for existing invoice');
      if (!dto.invoiceReference) {
        throw new BadRequestException('invoiceReference is required');
      }

      console.log('🔍 Looking up invoice:', dto.invoiceReference);
      const invoice = await this.prisma.paymentInvoice.findUnique({
        where: { reference: dto.invoiceReference },
        include: { quote: true },
      });

      if (!invoice) {
        console.error('❌ Invoice not found:', dto.invoiceReference);
        throw new BadRequestException('Invoice not found');
      }

      console.log('✅ Invoice found');
      quote = invoice.quote;
    }

    // ============================
    // 3. DIRECT/QR: Create quote for this payment
    // ============================
    if (!quote) {
      const quotePayload = this.buildQuoteDto(dto);
      quote = await this.quoteService.create(quotePayload);
    }

    // ============================
    // 2A. RESOLVE PAYER (Dynamic based on payment method)
    // ============================
    const paymentMethod = (dto.paymentMethod || quote.paymentMethod).toUpperCase();
    const payerResolution = await this.phoneResolution.resolvePayer(
      userId,
      paymentMethod,
      dto.payerPhone,
    );

    // ============================
    // 2B. RESOLVE RECIPIENT (Dynamic based on payout method)
    // ============================
    let recipient: { id: string; firstName: string; lastName: string } | null = null;
    let recipientPhone: string | null = null;
    let recipientName: string = 'External User';
    let payoutMethod: string = (dto.payoutMethod || quote.payoutMethod).toUpperCase();

    if (dto.flow === FlowType.DIRECT) {
      if (!dto.recipientPhone) {
        throw new BadRequestException('recipientPhone is required for DIRECT flow');
      }
      recipientPhone = dto.recipientPhone;

    } else if (dto.flow === FlowType.QR) {
      if (!dto.recipientHandle) {
        throw new BadRequestException('recipientHandle is required for QR flow');
      }

      const identity = await this.prisma.paymentIdentity.findUnique({
        where: { handle: dto.recipientHandle },
        include: { user: true },
      });

      if (!identity || !identity.user) {
        throw new BadRequestException('Invalid recipient handle');
      }

      const recipientUser = identity.user;
      recipient = recipientUser;
      
      // ✅ FOR NOW: All QR payments use MOMO payout
      // TODO: Upgrade to support BANK, CRYPTO in future
      payoutMethod = 'MOMO';

      recipientPhone = await this.phoneResolution.resolveRecipient(
        recipientUser.id,
        payoutMethod,
      );
      recipientName = `${recipientUser.firstName} ${recipientUser.lastName}`;
    }

    // ============================
    // 3. CREATE INVOICE
    // ============================
    console.log('📋 Creating payment invoice');
    const invoice = await this.prisma.paymentInvoice.create({
      data: {
        reference: `INV-${Date.now()}`,
        amount: quote.targetAmount,
        currency: { connect: { id: quote.targetCurrencyId } },
        country: 'CM',
        quote: { connect: { id: quote.id } },
        description: dto.description || 'TchokoPay Payment',
        paymentMethod,
        payoutMethod: payoutMethod,
        flow: dto.flow,
        recipient: recipient ? { connect: { id: recipient.id } } : undefined,
        recipientPhone,
        recipientName,
        createdBy: isGuest ? undefined : { connect: { id: userId } },
        expiresAt: quote.expiresAt,
      },
    });
    console.log('✅ Invoice created:', {
      reference: invoice.reference,
      amount: invoice.amount,
      paymentMethod,
      payoutMethod,
    });

    // ============================
    // 4. CREATE ATTEMPT
    // ============================
    console.log('📝 Creating payment attempt');
    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        invoice: { connect: { id: invoice.id } },
        method: invoice.paymentMethod,
        provider: invoice.paymentMethod,
        amount: quote.baseAmount,
        currency: { connect: { id: quote.baseCurrencyId } },
        flow: dto.flow,
        status: TransactionStatus.PENDING,
        idempotencyKey: idempotencyKey || undefined,
      },
    });
    console.log('✅ Payment attempt created:', { attemptId: attempt.id });

    // ============================
    // 5. PAYIN + PAYOUT (Dynamic based on payment method)
    // ============================
    const shouldProcessPayment =
      dto.flow === FlowType.DIRECT ||
      dto.flow === FlowType.QR ||
      (dto.flow === FlowType.REQUEST && dto.action === PaymentAction.PAY);

    let payinResponse: any = null; // Capture provider response
    let payoutResponse: any = null; // Capture payout provider response

    if (shouldProcessPayment) {
      console.log('💳 Processing PAYIN with:', paymentMethod);
      // ✅ PAYIN - use paymentMethod provider
      const payinProvider = this.providerFactory.getProvider(paymentMethod, invoice.country);

      if (payerResolution.requiresPhone) {
        console.log('📱 Payer phone required:', payerResolution.payerPhone);
        payinResponse = await payinProvider.payin({
          amount: Number(quote.baseAmount),
          currency: quote.baseCurrency.code,
          phone: payerResolution.payerPhone || undefined,
          reference: invoice.reference,
          description: invoice.description || undefined,
          metadata: {
            country: invoice.country,
            method: paymentMethod,
            type: 'COLLECTION',
          },
        });
      } else {
        console.log('✅ Payer resolved - authenticated user');
        payinResponse = await payinProvider.payin({
          amount: Number(quote.baseAmount),
          currency: quote.baseCurrency.code,
          reference: invoice.reference,
          description: invoice.description || undefined,
        });
      }

      console.log('✅ PAYIN completed:', {
        status: payinResponse?.status,
        invoiceId: payinResponse?.id || payinResponse?.invoiceId,
        paymentRequest: payinResponse?.paymentRequest ? '✅ Generated' : '❌ Not available',
        expiresAt: payinResponse?.expiresAt,
      });

      // If payin failed, mark attempt + invoice as FAILED and stop — do not proceed to payout
      if (payinResponse?.status === 'FAILED') {
        console.error('❌ PAYIN failed — aborting payout:', payinResponse?.error);
        await this.prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: TransactionStatus.FAILED,
            failureReason: payinResponse?.error || 'Provider returned FAILED',
            providerResponse: payinResponse,
          },
        });
        await this.prisma.paymentInvoice.update({
          where: { id: invoice.id },
          data: { status: TransactionStatus.FAILED },
        });
        return {
          message: 'Payment failed',
          invoice: { ...invoice, status: TransactionStatus.FAILED },
          quote,
          payment: { status: 'FAILED', error: payinResponse?.error },
        };
      }

      // Payin request accepted — mark PROCESSING and wait for webhook confirmation
      // Payout will only fire after the provider confirms the payer has actually paid
      const externalRef = payinResponse?.transactionId
        || payinResponse?.id
        || payinResponse?.invoiceId
        || null;

      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: TransactionStatus.PROCESSING,
          externalRef,
          providerResponse: payinResponse,
        },
      });

      await this.prisma.paymentInvoice.update({
        where: { id: invoice.id },
        data: { status: TransactionStatus.PROCESSING },
      });

      console.log('⏳ Payin request sent — awaiting confirmation via webhook or polling', {
        reference: invoice.reference,
        externalRef,
      });

      // Start sequential polling as a fallback alongside the webhook.
      // Works even when NETWALLETPAY_WEBHOOK_BASE_URL is localhost (not reachable externally).
      // PayoutExecutorService is idempotent, so both paths can fire safely.
      if (externalRef) {
        const pollingProvider = this.resolvePollingProvider(paymentMethod);
        this.pollingService.start({
          invoiceId: invoice.id,
          attemptId: attempt.id,
          externalRef,
          provider: pollingProvider,
          // Blink polling requires the BOLT11 payment request, not just the hash
          blinkPaymentRequest: pollingProvider === 'blink'
            ? (payinResponse?.paymentRequest ?? undefined)
            : undefined,
        });
      }
    }

    const result: any = {
      message: 'Payment initiated — awaiting confirmation',
      invoice,
      quote,
    };

    if (payinResponse) {
      result.payment = {
        status: payinResponse.status ?? 'PROCESSING',
        externalRef: payinResponse.transactionId || payinResponse.id || payinResponse.invoiceId,
        // Returned for Lightning so frontend can show QR code
        paymentRequest: payinResponse.paymentRequest ?? null,
        amount: payinResponse.amount ?? null,
        currency: payinResponse.currency ?? null,
        expiresAt: payinResponse.expiresAt ?? null,
        address: payinResponse.address ?? null,
        reference: payinResponse.reference ?? null,
      };
    }

    if (shouldProcessPayment) {
      await this.paymentEventService.emitPaymentComplete({
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        status: 'PENDING',
        stage: 'AWAITING_PAYER',
        paymentMethod: invoice.paymentMethod,
        payoutMethod: invoice.payoutMethod,
        amount: Number(quote.baseAmount),
        currency: quote.baseCurrency.code,
        paymentDetails: result.payment,
        timestamp: new Date(),
        userId: isGuest ? undefined : userId,
      });
    }

    await this.saveIdempotencyResponse(idempotencyKey, endpoint, result);
    return result;
  }

  private async saveIdempotencyResponse(
    idempotencyKey: string,
    endpoint: string,
    response: any,
  ) {
    if (!idempotencyKey) {
      return;
    }

    const existingKey = await this.prisma.idempotencyKey.findFirst({
      where: { key: idempotencyKey, endpoint },
    });

    if (existingKey) {
      await this.prisma.idempotencyKey.update({
        where: { id: existingKey.id },
        data: { response },
      });
      return;
    }

    await this.prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint,
        response,
      },
    });
  }

  private validatePaymentFlow(dto: CreatePaymentDto) {
    if (!dto.flow) {
      throw new BadRequestException('flow is required');
    }

    if (dto.flow === FlowType.REQUEST) {
      if (!dto.action) {
        throw new BadRequestException('action is required for REQUEST flow');
      }

      // REQUEST CREATE: Recipient creates invoice (doesn't know payer's currency yet)
      if (dto.action === PaymentAction.CREATE) {
        // Do NOT require baseCurrency - payer chooses it during REQUEST PAY
        if (!dto.targetCurrency || !dto.amount || !dto.amountType) {
          throw new BadRequestException(
            'targetCurrency, amount, and amountType are required for REQUEST CREATE',
          );
        }
        if (!dto.payoutMethod) {
          throw new BadRequestException(
            'payoutMethod is required for REQUEST CREATE',
          );
        }
        
        // For MOMO payout: guest users must provide payerPhone (their MOMO number to receive)
        if (dto.payoutMethod?.toUpperCase() === 'MOMO') {
          // Check if user is registered (has non-empty userId after @CurrentUser extraction)
          // If unregistered/guest and MOMO, payerPhone is required for receiving
          // This validation is optional here since it's enforced in CreateRequestUseCase
        }
        // paymentMethod is optional for REQUEST CREATE (payer chooses during REQUEST PAY)
      }

      // REQUEST PAY: Payer pays existing invoice
      if (dto.action === PaymentAction.PAY) {
        if (!dto.invoiceReference) {
          throw new BadRequestException(
            'invoiceReference is required for REQUEST PAY',
          );
        }
        if (!dto.baseCurrency) {
          throw new BadRequestException(
            'baseCurrency is required for REQUEST PAY',
          );
        }
        if (!dto.paymentMethod) {
          throw new BadRequestException(
            'paymentMethod is required for REQUEST PAY',
          );
        }
        
        // For MOMO payment: guest users must provide payerPhone
        // Registered users with MOMO: payerPhone auto-resolved if verified
        // (Phone resolution validation happens in PhoneResolutionService)
      }

      return; // Validated REQUEST flow, exit early
    }

    // DIRECT Flow
    if (dto.flow === FlowType.DIRECT) {
      if (!dto.recipientPhone) {
        throw new BadRequestException(
          'recipientPhone is required for DIRECT flow',
        );
      }
      if (!dto.amount || !dto.amountType) {
        throw new BadRequestException(
          'amount and amountType are required for DIRECT flow',
        );
      }
      if (!dto.targetCurrency) {
        throw new BadRequestException(
          'targetCurrency is required for DIRECT flow',
        );
      }
      return;
    }

    // QR Flow
    if (dto.flow === FlowType.QR) {
      if (!dto.recipientHandle) {
        throw new BadRequestException(
          'recipientHandle is required for QR flow',
        );
      }
      if (!dto.amount || !dto.amountType) {
        throw new BadRequestException(
          'amount and amountType are required for QR flow',
        );
      }
      if (!dto.targetCurrency) {
        throw new BadRequestException(
          'targetCurrency is required for QR flow',
        );
      }
      return;
    }

    throw new BadRequestException(
      'Invalid flow type. Must be DIRECT, QR, or REQUEST',
    );
  }

  private buildQuoteDto(dto: CreatePaymentDto): CreateQuoteDto {
    if (!dto.baseCurrency || !dto.targetCurrency) {
      throw new BadRequestException('baseCurrency and targetCurrency are required');
    }
    if (!dto.amount || !dto.amountType) {
      throw new BadRequestException('amount and amountType are required');
    }
    if (!dto.paymentMethod || !dto.payoutMethod) {
      throw new BadRequestException('paymentMethod and payoutMethod are required');
    }

    // Map payment flow to quote flow expectations.
    let flow: FlowEnum;
    switch (dto.flow) {
      case FlowType.DIRECT:
        flow = FlowEnum.DIRECT;
        break;
      case FlowType.QR:
        flow = FlowEnum.QR;
        break;
      case FlowType.REQUEST:
      default:
        flow = FlowEnum.REQUEST;
    }

    const paymentMethod = dto.paymentMethod.toUpperCase() as PaymentMethodEnum;
    const payoutMethod = dto.payoutMethod.toUpperCase() as PaymentMethodEnum;

    return {
      baseCurrency: dto.baseCurrency.toString().toUpperCase(),
      targetCurrency: dto.targetCurrency.toString().toUpperCase(),
      amount: dto.amount,
      amountType: dto.amountType,
      paymentMethod,
      payoutMethod,
      flow,
    };
  }

  // For REQUEST CREATE: Quote is built without baseCurrency (payer chooses later during REQUEST PAY)
  private buildQuoteForRequest(
    dto: CreatePaymentDto,
  ): CreateQuoteDto {
    if (!dto.targetCurrency || !dto.amount || !dto.amountType) {
      throw new BadRequestException(
        'targetCurrency, amount, and amountType are required',
      );
    }
    if (!dto.payoutMethod) {
      throw new BadRequestException('payoutMethod is required');
    }

    // For REQUEST CREATE, use targetCurrency as both base and target initially
    // Payer will specify baseCurrency during REQUEST PAY
    return {
      baseCurrency: dto.targetCurrency.toString().toUpperCase(),
      targetCurrency: dto.targetCurrency.toString().toUpperCase(),
      amount: dto.amount,
      amountType: dto.amountType,
      paymentMethod: PaymentMethodEnum.MOMO, // Placeholder - payer chooses during REQUEST PAY
      payoutMethod: (dto.payoutMethod as PaymentMethodEnum).toUpperCase() as PaymentMethodEnum,
      flow: FlowEnum.REQUEST,
    };
  }

  /** Map the payment method to the correct polling provider. */
  private resolvePollingProvider(paymentMethod: string): PollingProvider {
    const m = paymentMethod.toUpperCase();
    if (m === 'LIGHTNING' || m === 'BTC') return 'blink';
    return 'netwalletpay'; // MOMO, ORANGE, CARD, BANK all go through Netwalletpay
  }
}
