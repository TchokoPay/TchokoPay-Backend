import { Injectable, BadRequestException } from '@nestjs/common';
import {
  Prisma,
  TransactionStatus,
  TransactionType,
  LedgerEntryType,
} from '@prisma/client';
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

@Injectable()
export class ProcessPaymentUseCase {
  constructor(
    private quoteService: QuoteService,
    private prisma: PrismaService,
    private providerFactory: PaymentProviderFactory,
    private phoneResolution: PhoneResolutionService,
    private paymentEventService: PaymentEventService,
  ) {}

  async execute({ userId, dto }: { userId: string; dto: CreatePaymentDto }) {
    const endpoint = 'payments.process';
    const idempotencyKey = (dto.idempotencyKey || '').trim();

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
        createdBy: { connect: { id: userId } },
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
        });
      }

      console.log('✅ PAYIN completed:', {
        status: payinResponse?.status,
        invoiceId: payinResponse?.id || payinResponse?.invoiceId,
        paymentRequest: payinResponse?.paymentRequest ? '✅ Generated' : '❌ Not available',
        expiresAt: payinResponse?.expiresAt,
      });

      // Store provider response and external reference
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: TransactionStatus.SUCCESS,
          externalRef: payinResponse?.id || payinResponse?.invoiceId, // Store invoice ID
          providerResponse: payinResponse, // Store full response for Lightning/Crypto details
        },
      });

      await this.prisma.paymentInvoice.update({
        where: { id: invoice.id },
        data: { status: TransactionStatus.SUCCESS },
      });

      console.log('💸 Processing PAYOUT with:', invoice.payoutMethod);
      const payoutProvider = this.providerFactory.getProvider(
        invoice.payoutMethod,
        invoice.country,
      );

      const payoutRequiresPhone = ['MOMO', 'ORANGE', 'CARD', 'BANK'].includes(
        invoice.payoutMethod?.toUpperCase(),
      );

      if (payoutRequiresPhone) {
        if (!recipientPhone) {
          console.error('❌ Recipient phone required for payout');
          throw new BadRequestException('Recipient phone required for payout method');
        }

        console.log('📱 Sending payout to:', recipientPhone, 'via', invoice.payoutMethod);
        payoutResponse = await payoutProvider.payout({
          amount: Number(quote.targetAmount),
          currency: quote.targetCurrency.code,
          phone: recipientPhone,
          reference: invoice.reference,
          metadata: {
            country: invoice.country,
            method: invoice.payoutMethod,
            type: 'PAYOUT',
          },
        });
      } else {
        payoutResponse = await payoutProvider.payout({
          amount: Number(quote.targetAmount),
          currency: quote.targetCurrency.code,
          phone: undefined,
          reference: invoice.reference,
          metadata: {
            country: invoice.country,
            method: invoice.payoutMethod,
            type: 'PAYOUT',
          },
        });
      }

      console.log('✅ PAYOUT completed:', {
        status: payoutResponse?.status,
        reference: payoutResponse?.reference,
        transactionId: payoutResponse?.transactionId || payoutResponse?.id,
      });

      // Record transaction and ledger entries for a successful flow
      const payerWallet = await this.getOrCreateWallet(userId, quote.baseCurrencyId);
      const recipientWallet = recipient
        ? await this.getOrCreateWallet(recipient.id, quote.targetCurrencyId)
        : null;

      const baseAmountDecimal = new Prisma.Decimal(quote.baseAmount);
      const feeDecimal = quote.fee ? new Prisma.Decimal(quote.fee) : new Prisma.Decimal(0);
      const exchangeRateDecimal = quote.exchangeRate ? new Prisma.Decimal(quote.exchangeRate) : new Prisma.Decimal(1);

      const transaction = await this.prisma.transaction.create({
        data: {
          type: TransactionType.PAYMENT,
          status: TransactionStatus.SUCCESS,
          quote: { connect: { id: quote.id } },
          amount: baseAmountDecimal,
          currency: { connect: { id: quote.baseCurrencyId } },
          exchangeRate: exchangeRateDecimal,
          fee: feeDecimal,
          netAmount: baseAmountDecimal.sub(feeDecimal),
          baseCurrencyId: quote.baseCurrencyId,
          targetCurrencyId: quote.targetCurrencyId,
          baseAmount: baseAmountDecimal,
          targetAmount: new Prisma.Decimal(quote.targetAmount),
          rateSource: quote.rateSource,
          reference: invoice.reference,
          idempotencyKey: idempotencyKey || undefined,
          senderId: userId,
          receiverId: recipient?.id ?? null,
          wallet: { connect: { id: payerWallet.id } },
          user: { connect: { id: userId } },
        },
      });

      await this.createLedgerEntry(
        payerWallet,
        transaction,
        invoice,
        quote.baseAmount,
        LedgerEntryType.DEBIT,
      );

      if (recipientWallet) {
        await this.createLedgerEntry(
          recipientWallet,
          transaction,
          invoice,
          quote.targetAmount,
          LedgerEntryType.CREDIT,
        );
      }
    }

    const result: any = {
      message: 'Process completed',
      invoice,
      quote,
    };

    // Include Lightning/Crypto provider details if available
    if (payinResponse) {
      result.payment = {
        status: payinResponse.status,
        invoiceId: payinResponse.id || payinResponse.invoiceId,
        paymentRequest: payinResponse.paymentRequest, // Lightning QR/invoice string
        amount: payinResponse.amount,
        currency: payinResponse.currency,
        expiresAt: payinResponse.expiresAt, // When invoice expires
        address: payinResponse.address, // For on-chain Bitcoin
        reference: payinResponse.reference,
      };
    }

    // Include payout provider details if available
    if (payoutResponse) {
      result.payout = {
        status: payoutResponse.status,
        transactionId: payoutResponse.transactionId || payoutResponse.id,
        reference: payoutResponse.reference,
        provider: invoice.payoutMethod,
      };
    }

    // ============================
    // EMIT PAYMENT COMPLETE EVENT FOR WEBSOCKET
    // ============================
    if (shouldProcessPayment) {
      console.log('📡 Emitting payment.complete event for real-time notifications');
      await this.paymentEventService.emitPaymentComplete({
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        status: 'SUCCESS',
        paymentMethod: invoice.paymentMethod,
        payoutMethod: invoice.payoutMethod,
        amount: Number(quote.baseAmount),
        currency: quote.baseCurrency.code,
        paymentDetails: result.payment,
        payoutDetails: result.payout,
        timestamp: new Date(),
        userId,
      });

      // Notify user via WebSocket
      await this.paymentEventService.notifyUser(userId, {
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        status: 'SUCCESS',
        paymentMethod: invoice.paymentMethod,
        payoutMethod: invoice.payoutMethod,
        amount: Number(quote.baseAmount),
        currency: quote.baseCurrency.code,
        paymentDetails: result.payment,
        payoutDetails: result.payout,
        timestamp: new Date(),
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

  private async getOrCreateWallet(userId: string, currencyId: string) {
    // Validate currency exists
    const currency = await this.prisma.currency.findUnique({
      where: { id: currencyId },
    });

    if (!currency) {
      throw new BadRequestException(`Currency not found: ${currencyId}`);
    }

    let wallet = await this.prisma.wallet.findFirst({
      where: { userId, currencyId },
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: {
          user: { connect: { id: userId } },
          currency: { connect: { id: currencyId } },
          totalProcessed: new Prisma.Decimal(0),
          totalVolume: new Prisma.Decimal(0),
          totalFeesEarned: new Prisma.Decimal(0),
        },
      });
    }

    return wallet;
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

  private async createLedgerEntry(
    wallet: any,
    transaction: any,
    invoice: any,
    amount: Prisma.Decimal,
    type: 'CREDIT' | 'DEBIT',
  ) {
    const newTotals = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        totalProcessed: { increment: amount },
        totalVolume: { increment: amount },
      },
    });

    await this.prisma.ledger.create({
      data: {
        wallet: { connect: { id: wallet.id } },
        transaction: { connect: { id: transaction.id } },
        invoice: { connect: { id: invoice.id } },
        amount,
        type,
        balanceAfter: newTotals.totalProcessed,
      },
    });
  }
}