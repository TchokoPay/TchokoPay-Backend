import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PaymentProviderFactory } from '../providers/payment-provider.factory.js';
import { TransactionStatus, Prisma } from '@prisma/client';
import { FlowType } from '../enums/payment.enums.js';
import { QuoteService } from '../../quote/quote.service.js';
import { PaymentEventService } from '../services/payment-event.service.js';
import { PaymentPollingService, PollingProvider } from '../services/payment-polling.service.js';

type QuoteWithCurrencies = Prisma.QuoteGetPayload<{
  include: { baseCurrency: true; targetCurrency: true };
}>;

@Injectable()
export class PayRequestUseCase {
  constructor(
    private prisma: PrismaService,
    private providerFactory: PaymentProviderFactory,
    private quoteService: QuoteService,
    private paymentEventService: PaymentEventService,
    private pollingService: PaymentPollingService,
  ) {}

  async execute(userId: string, dto: any) {
    if (!dto.invoiceReference) {
      throw new BadRequestException('invoiceReference is required for request payment');
    }

    const invoice = await this.prisma.paymentInvoice.findUnique({
      where: { reference: dto.invoiceReference },
      include: { quote: true, recipient: true, currency: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status !== TransactionStatus.PENDING) {
      throw new BadRequestException('Invoice is not pending');
    }

    if (new Date() > invoice.expiresAt) {
      throw new BadRequestException('Invoice has expired');
    }

    const isGuest = !userId?.trim();

    let payerPhone: string | undefined;
    if (isGuest) {
      if (!dto.payerPhone) {
        throw new BadRequestException(
          'Guest payments require a payerPhone. Please provide your MOMO number.',
        );
      }
      payerPhone = dto.payerPhone as string;
    } else {
      const payerContact = await this.prisma.userContact.findFirst({
        where: { userId, type: 'PHONE', isVerified: true },
      });

      if (!payerContact && !dto.payerPhone) {
        throw new BadRequestException(
          'No verified phone found. Please verify your phone in settings or provide payerPhone.',
        );
      }

      payerPhone = payerContact?.value ?? (dto.payerPhone as string | undefined);
    }

    const paymentMethod = (dto.paymentMethod || 'MOMO')?.toUpperCase();

    const paymentRequest = await this.prisma.paymentRequest.findFirst({
      where: {
        metadata: { path: ['invoiceId'], equals: invoice.id },
      },
    });

    const requestMetadata = paymentRequest?.metadata as any;
    const amountType = requestMetadata?.amountType || 'RECEIVE';

    if (!dto.baseCurrency) {
      throw new BadRequestException('baseCurrency is required to pay a request');
    }

    const createQuotePayload = {
      amount: Number(invoice.amount),
      amountType,
      baseCurrency: dto.baseCurrency,
      targetCurrency: invoice.currency.code,
      paymentMethod,
      payoutMethod: invoice.payoutMethod,
      flow: 'REQUEST' as any,
    };

    const quote = (await this.quoteService.create(
      createQuotePayload,
    )) as QuoteWithCurrencies;

    await this.prisma.paymentInvoice.update({
      where: { id: invoice.id },
      data: {
        quote: { connect: { id: quote.id } },
        paymentMethod,
        status: TransactionStatus.PROCESSING,
        createdBy: isGuest
          ? { disconnect: true }
          : { connect: { id: userId } },
      },
    });

    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        invoice: { connect: { id: invoice.id } },
        method: paymentMethod,
        provider: paymentMethod,
        flow: FlowType.REQUEST,
        amount: quote.baseAmount,
        currency: { connect: { id: quote.baseCurrencyId } },
        status: TransactionStatus.PENDING,
      },
    });

    const payinProvider = this.providerFactory.getProvider(paymentMethod, invoice.country);
    const payinResponse = await payinProvider.payin({
      amount: Number(quote.baseAmount),
      currency: quote.baseCurrency.code,
      phone: payerPhone,
      reference: invoice.reference,
      description: invoice.description || undefined,
      metadata: {
        country: invoice.country,
        method: paymentMethod,
        type: 'COLLECTION',
      },
    });

    if (payinResponse?.status === 'FAILED') {
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
      if (paymentRequest) {
        await this.prisma.paymentRequest.update({
          where: { id: paymentRequest.id },
          data: { status: TransactionStatus.FAILED },
        });
      }

      return {
        message: 'Payment failed',
        invoice: { ...invoice, status: TransactionStatus.FAILED },
        quote,
        payment: { status: 'FAILED', error: payinResponse?.error },
      };
    }

    const externalRef =
      payinResponse?.transactionId ||
      payinResponse?.id ||
      payinResponse?.invoiceId ||
      null;

    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: TransactionStatus.PROCESSING,
        externalRef,
        providerResponse: payinResponse,
      },
    });

    const result: any = {
      message: 'Payment initiated - awaiting confirmation',
      invoice: { ...invoice, status: TransactionStatus.PROCESSING, quote },
      quote,
      payment: {
        status: payinResponse?.status ?? 'PROCESSING',
        externalRef,
        paymentRequest: payinResponse?.paymentRequest ?? null,
        amount: payinResponse?.amount ?? null,
        currency: payinResponse?.currency ?? null,
        expiresAt: payinResponse?.expiresAt ?? null,
        address: payinResponse?.address ?? null,
        reference: payinResponse?.reference ?? null,
      },
    };

    await this.paymentEventService.emitPaymentComplete({
      invoiceId: invoice.id,
      invoiceReference: invoice.reference,
      status: 'PENDING',
      stage: 'AWAITING_PAYER',
      paymentMethod,
      payoutMethod: invoice.payoutMethod,
      amount: Number(quote.baseAmount),
      currency: quote.baseCurrency.code,
      paymentDetails: result.payment,
      timestamp: new Date(),
      userId: isGuest ? undefined : userId,
    });

    if (externalRef) {
      const pollingProvider = this.resolvePollingProvider(paymentMethod);
      this.pollingService.start({
        invoiceId: invoice.id,
        attemptId: attempt.id,
        externalRef,
        provider: pollingProvider,
        blinkPaymentRequest:
          pollingProvider === 'blink'
            ? (payinResponse?.paymentRequest ?? undefined)
            : undefined,
      });
    }

    return result;
  }

  private resolvePollingProvider(method: string): PollingProvider {
    return method.toUpperCase() === 'LIGHTNING' || method.toUpperCase() === 'BTC'
      ? 'blink'
      : 'netwalletpay';
  }
}
