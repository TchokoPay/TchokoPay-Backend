import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  TransactionStatus,
  TransactionType,
  LedgerEntryType,
  PayoutMethod,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PaymentProviderFactory } from '../providers/payment-provider.factory.js';
import { PaymentEventService } from './payment-event.service.js';

@Injectable()
export class PayoutExecutorService {
  private readonly logger = new Logger(PayoutExecutorService.name);

  constructor(
    private prisma: PrismaService,
    private providerFactory: PaymentProviderFactory,
    private paymentEventService: PaymentEventService,
  ) {}

  /**
   * Execute payout for a confirmed payin.
   * Called by webhook handlers and the polling service after payin is verified as paid.
   * Returns the new Payout/PayoutAttempt IDs so the caller can start payout polling.
   */
  async execute(invoiceId: string): Promise<{
    payoutId: string;
    payoutAttemptId: string;
    payoutExternalRef: string | null;
  } | null> {
    const invoice = await this.prisma.paymentInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        quote: {
          include: { baseCurrency: true, targetCurrency: true },
        },
      },
    });

    if (!invoice) {
      this.logger.error(`Invoice not found: ${invoiceId}`);
      return null;
    }
    if (!invoice.quote) {
      this.logger.error(`No quote on invoice ${invoiceId}`);
      return null;
    }

    // Idempotency: don't double-pay
    const existing = await this.prisma.payout.findUnique({
      where: { invoiceId },
    });
    if (existing && existing.status !== TransactionStatus.FAILED) {
      this.logger.warn(`Payout already exists for invoice ${invoiceId} (status: ${existing.status}) — skipping`);
      return null;
    }

    const { quote } = invoice;

    const payout = await this.prisma.payout.upsert({
      where: { invoiceId },
      create: {
        invoice: { connect: { id: invoiceId } },
        amount: quote.targetAmount,
        currency: quote.targetCurrency.code,
        method: this.mapPayoutMethod(invoice.payoutMethod),
        status: TransactionStatus.PROCESSING,
      },
      update: { status: TransactionStatus.PROCESSING },
    });

    const payoutAttempt = await this.prisma.payoutAttempt.create({
      data: {
        payout: { connect: { id: payout.id } },
        provider: invoice.payoutMethod,
        status: TransactionStatus.PROCESSING,
      },
    });

    try {
      const payoutProvider = this.providerFactory.getProvider(
        invoice.payoutMethod,
        invoice.country,
      );

      const response = await payoutProvider.payout({
        amount: Number(quote.targetAmount),
        currency: quote.targetCurrency.code,
        phone: invoice.recipientPhone ?? undefined,
        reference: invoice.reference,
        description: invoice.description || undefined,
        metadata: {
          country: invoice.country,
          method: invoice.payoutMethod,
          type: 'PAYOUT',
        },
      });

      if (response?.status === 'FAILED') {
        await this.markPayoutFailed(payout.id, payoutAttempt.id, response.error);
        this.logger.error(`Payout FAILED for invoice ${invoice.reference}: ${response.error}`);
        return null;
      }

      const payoutExternalRef: string | null = response?.transactionId ?? null;

      // Store payout transactionId so the payout webhook/poll can confirm it later
      await this.prisma.payoutAttempt.update({
        where: { id: payoutAttempt.id },
        data: { status: TransactionStatus.PROCESSING, externalRef: payoutExternalRef },
      });

      await this.prisma.payout.update({
        where: { id: payout.id },
        data: { status: TransactionStatus.PROCESSING },
      });

      // Invoice is SUCCESS — payout was dispatched (webhook/poll will finalize payout)
      await this.prisma.paymentInvoice.update({
        where: { id: invoiceId },
        data: { status: TransactionStatus.PROCESSING },
      });

      await this.recordTransaction(invoice, quote);

      this.logger.log(`✅ Payout dispatched for ${invoice.reference} → txId: ${payoutExternalRef}`);

      this.paymentEventService.emitPaymentComplete({
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        status: 'PROCESSING',
        stage: 'PAYOUT_PROCESSING',
        paymentMethod: invoice.paymentMethod as string,
        payoutMethod: invoice.payoutMethod,
        amount: Number(quote.baseAmount),
        currency: quote.baseCurrency.code,
        payoutDetails: {
          status: 'PROCESSING',
          transactionId: payoutExternalRef ?? undefined,
        },
        timestamp: new Date(),
        userId: invoice.createdById ?? undefined,
      });

      // Return IDs so the caller can start payout polling
      return { payoutId: payout.id, payoutAttemptId: payoutAttempt.id, payoutExternalRef };
    } catch (error) {
      this.logger.error(`Payout exception for invoice ${invoiceId}:`, error);
      await this.markPayoutFailed(payout.id, payoutAttempt.id, (error as Error).message);
      return null;
    }
  }

  /**
   * Called when a payout webhook confirms the recipient received funds.
   */
  async confirmPayout(externalRef: string): Promise<void> {
    const attempt = await this.prisma.payoutAttempt.findFirst({
      where: { externalRef },
      include: {
        payout: {
          include: {
            invoice: {
              include: {
                quote: {
                  include: { baseCurrency: true, targetCurrency: true },
                },
              },
            },
          },
        },
      },
    });

    if (!attempt) {
      this.logger.warn(`No PayoutAttempt found for externalRef: ${externalRef}`);
      return;
    }

    if (attempt.status === TransactionStatus.SUCCESS) {
      this.logger.log(`Payout already confirmed for externalRef: ${externalRef}`);
      return;
    }

    await this.prisma.payoutAttempt.update({
      where: { id: attempt.id },
      data: { status: TransactionStatus.SUCCESS },
    });

    await this.prisma.payout.update({
      where: { id: attempt.payoutId },
      data: { status: TransactionStatus.SUCCESS },
    });
    await this.prisma.paymentInvoice.update({
      where: { id: attempt.payout.invoiceId },
      data: { status: TransactionStatus.SUCCESS },
    });

    const invoice = attempt.payout.invoice;
    const quote = invoice.quote;

    if (quote) {
      await this.updateRequestStatusForInvoice(invoice.id, TransactionStatus.SUCCESS);
      this.paymentEventService.emitPaymentComplete({
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        status: 'SUCCESS',
        stage: 'COMPLETED',
        paymentMethod: invoice.paymentMethod as string,
        payoutMethod: invoice.payoutMethod,
        amount: Number(quote.baseAmount),
        currency: quote.baseCurrency.code,
        payoutDetails: {
          status: 'SUCCESS',
          transactionId: externalRef,
        },
        timestamp: new Date(),
        userId: invoice.createdById ?? undefined,
      });
    }

    this.logger.log(`✅ Payout confirmed via webhook: ${externalRef}`);
  }

  async failPayout(externalRef: string, reason?: string): Promise<void> {
    const attempt = await this.prisma.payoutAttempt.findFirst({
      where: { externalRef },
      include: {
        payout: {
          include: {
            invoice: {
              include: {
                quote: {
                  include: { baseCurrency: true, targetCurrency: true },
                },
              },
            },
          },
        },
      },
    });

    if (!attempt) {
      this.logger.warn(`No PayoutAttempt found to fail for externalRef: ${externalRef}`);
      return;
    }

    if (attempt.status === TransactionStatus.FAILED) {
      this.logger.log(`Payout already failed for externalRef: ${externalRef}`);
      return;
    }

    await this.prisma.payoutAttempt.update({
      where: { id: attempt.id },
      data: { status: TransactionStatus.FAILED },
    });
    await this.prisma.payout.update({
      where: { id: attempt.payoutId },
      data: { status: TransactionStatus.FAILED },
    });
    await this.prisma.paymentInvoice.update({
      where: { id: attempt.payout.invoiceId },
      data: { status: TransactionStatus.FAILED },
    });

    const invoice = attempt.payout.invoice;
    const quote = invoice.quote;

    if (quote) {
      await this.updateRequestStatusForInvoice(invoice.id, TransactionStatus.FAILED);
      this.paymentEventService.emitPaymentComplete({
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        status: 'FAILED',
        stage: 'FAILED',
        paymentMethod: invoice.paymentMethod as string,
        payoutMethod: invoice.payoutMethod,
        amount: Number(quote.baseAmount),
        currency: quote.baseCurrency.code,
        payoutDetails: {
          status: 'FAILED',
          transactionId: externalRef,
          reference: reason,
        },
        timestamp: new Date(),
        userId: invoice.createdById ?? undefined,
      });
    }

    this.logger.warn(`Payout failed: ${externalRef}${reason ? ` | ${reason}` : ''}`);
  }

  private async markPayoutFailed(payoutId: string, attemptId: string, reason?: string) {
    await this.prisma.payoutAttempt.update({
      where: { id: attemptId },
      data: { status: TransactionStatus.FAILED },
    });
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status: TransactionStatus.FAILED },
    });
  }

  private async updateRequestStatusForInvoice(
    invoiceId: string,
    status: TransactionStatus,
  ) {
    await this.prisma.paymentRequest.updateMany({
      where: {
        metadata: { path: ['invoiceId'], equals: invoiceId },
      },
      data: { status },
    });
  }

  private async recordTransaction(invoice: any, quote: any) {
    if (!invoice.createdById) return;

    const payerWallet = await this.getOrCreateWallet(invoice.createdById, quote.baseCurrencyId);
    const baseAmount = new Prisma.Decimal(quote.baseAmount);
    const fee = quote.fee ? new Prisma.Decimal(quote.fee) : new Prisma.Decimal(0);
    const exchangeRate = quote.exchangeRate
      ? new Prisma.Decimal(quote.exchangeRate)
      : new Prisma.Decimal(1);

    const transaction = await this.prisma.transaction.create({
      data: {
        type: TransactionType.PAYMENT,
        status: TransactionStatus.SUCCESS,
        quote: { connect: { id: quote.id } },
        amount: baseAmount,
        currency: { connect: { id: quote.baseCurrencyId } },
        exchangeRate,
        fee,
        netAmount: baseAmount.sub(fee),
        baseCurrencyId: quote.baseCurrencyId,
        targetCurrencyId: quote.targetCurrencyId,
        baseAmount,
        targetAmount: new Prisma.Decimal(quote.targetAmount),
        rateSource: quote.rateSource ?? null,
        reference: invoice.reference,
        senderId: invoice.createdById,
        receiverId: invoice.recipientId ?? null,
        wallet: { connect: { id: payerWallet.id } },
        user: { connect: { id: invoice.createdById } },
      },
    });

    await this.createLedgerEntry(payerWallet, transaction, invoice, quote.baseAmount, LedgerEntryType.DEBIT);

    if (invoice.recipientId) {
      const recipientWallet = await this.getOrCreateWallet(invoice.recipientId, quote.targetCurrencyId);
      await this.createLedgerEntry(recipientWallet, transaction, invoice, quote.targetAmount, LedgerEntryType.CREDIT);
    }
  }

  private async getOrCreateWallet(userId: string, currencyId: string) {
    let wallet = await this.prisma.wallet.findFirst({ where: { userId, currencyId } });
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

  private async createLedgerEntry(wallet: any, transaction: any, invoice: any, amount: any, type: LedgerEntryType) {
    const amountDecimal = new Prisma.Decimal(amount);
    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        totalProcessed: { increment: amountDecimal },
        totalVolume: { increment: amountDecimal },
      },
    });
    await this.prisma.ledger.create({
      data: {
        wallet: { connect: { id: wallet.id } },
        transaction: { connect: { id: transaction.id } },
        invoice: { connect: { id: invoice.id } },
        amount: amountDecimal,
        type,
        balanceAfter: updated.totalProcessed,
      },
    });
  }

  private mapPayoutMethod(method: string): PayoutMethod {
    switch (method.toUpperCase()) {
      case 'MOMO':   return PayoutMethod.MOMO;
      case 'ORANGE': return PayoutMethod.ORANGE;
      case 'BANK':   return PayoutMethod.BANK;
      case 'CRYPTO': return PayoutMethod.CRYPTO;
      default:       return PayoutMethod.MOMO;
    }
  }
}
