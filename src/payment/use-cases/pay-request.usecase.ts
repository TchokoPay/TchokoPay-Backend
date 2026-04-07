import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PaymentProviderFactory } from '../providers/payment-provider.factory.js';
import { TransactionStatus, Prisma } from '@prisma/client';
import { FlowType } from '../enums/payment.enums.js';
import { QuoteService } from '../../quote/quote.service.js';

type QuoteWithCurrencies = Prisma.QuoteGetPayload<{
  include: { baseCurrency: true; targetCurrency: true };
}>;
@Injectable()
export class PayRequestUseCase {
  constructor(
    private prisma: PrismaService,
    private providerFactory: PaymentProviderFactory,
    private quoteService: QuoteService,
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

    const payerContact = await this.prisma.userContact.findFirst({
      where: { userId, type: 'PHONE', isVerified: true },
    });

    if (!payerContact) {
      throw new BadRequestException('Payer must have a verified phone contact');
    }

    // Get payment method from request or use default
    const paymentMethod = (dto.paymentMethod || 'MOMO')?.toUpperCase();

    // Get metadata from payment request to understand the original request
    const paymentRequest = await this.prisma.paymentRequest.findFirst({
      where: {
        metadata: { path: ['invoiceId'], equals: invoice.id },
      },
    });

    if (!paymentRequest) {
      throw new BadRequestException('Payment request not found');
    }

    const requestMetadata = paymentRequest.metadata as any;
    const amountType = requestMetadata?.amountType || 'PAY';

    // Validate baseCurrency is provided
    if (!dto.baseCurrency) {
      throw new BadRequestException('baseCurrency is required to pay a request');
    }

    // Now create the quote based on payer's payment method + invoice details
    const createQuotePayload = {
      amount: Number(invoice.amount),
      amountType,
      baseCurrency: dto.baseCurrency,
      targetCurrency: invoice.currency.code,
      paymentMethod,
      payoutMethod: invoice.payoutMethod,
      flow: 'REQUEST' as any,
    };

    const quote = await this.quoteService.create(createQuotePayload) as QuoteWithCurrencies;

    // Update invoice with the quote and payment method
    await this.prisma.paymentInvoice.update({
      where: { id: invoice.id },
      data: {
        quote: { connect: { id: quote.id } },
        paymentMethod,
      },
    });

    const payinProvider = this.providerFactory.getProvider(paymentMethod);

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

    // PAYIN FROM PAYER - use paymentMethod provider
    await payinProvider.payin({
      amount: Number(quote.baseAmount),
      currency: quote.baseCurrency.code,
      phone: payerContact.value,
      reference: invoice.reference,
    });

    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: TransactionStatus.SUCCESS },
    });

    // PAYOUT TO REQUESTER - use payoutMethod provider
    const payoutProvider = this.providerFactory.getProvider(invoice.payoutMethod);

    await payoutProvider.payout({
      amount: Number(quote.targetAmount),
      currency: quote.targetCurrency.code,
      phone: invoice.recipientPhone,
      reference: invoice.reference,
    });

    await this.prisma.paymentInvoice.update({
      where: { id: invoice.id },
      data: { status: TransactionStatus.SUCCESS },
    });

    await this.prisma.quote.update({
      where: { id: quote.id },
      data: { isUsed: true },
    });

    await this.prisma.paymentRequest.updateMany({
      where: {
        metadata: { path: ['invoiceId'], equals: invoice.id },
      },
      data: { status: TransactionStatus.SUCCESS },
    });

    return {
      message: 'Payment request paid successfully',
      invoice: { ...invoice, status: TransactionStatus.SUCCESS },
      attempt: { ...attempt, status: TransactionStatus.SUCCESS },
    };
  }
}
