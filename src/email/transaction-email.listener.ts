import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PaymentCompleteEvent } from '../payment/services/payment-event.service.js';
import { EmailService } from './email.service.js';

@Injectable()
export class TransactionEmailListener {
  private readonly logger = new Logger(TransactionEmailListener.name);
  private readonly sentKeys = new Set<string>();

  constructor(private readonly emailService: EmailService) {}

  @OnEvent('payment.complete')
  async handlePaymentComplete(event: PaymentCompleteEvent) {
    const status = this.resolveEmailStatus(event);
    if (!status || !event.userId) return;

    const key = `${event.invoiceId}:${status}`;
    if (this.sentKeys.has(key)) return;
    this.sentKeys.add(key);

    try {
      await this.emailService.sendTransactionStatusNotice({
        userId: event.userId,
        status,
        reference: event.invoiceReference,
        amount: event.amount,
        currency: event.currency,
        paymentMethod: event.paymentMethod,
        payoutMethod: event.payoutMethod,
        failureReason: this.getFailureReason(event),
      });
    } catch (error) {
      this.sentKeys.delete(key);
      this.logger.error(
        `Transaction email failed for ${event.invoiceReference}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private resolveEmailStatus(
    event: PaymentCompleteEvent,
  ): 'SUCCESS' | 'FAILED' | null {
    if (event.status === 'SUCCESS' && event.stage === 'COMPLETED') {
      return 'SUCCESS';
    }

    if (event.status === 'FAILED' && event.stage === 'FAILED') {
      return 'FAILED';
    }

    return null;
  }

  private getFailureReason(event: PaymentCompleteEvent) {
    return (
      event.payoutDetails?.failureReason ||
      event.payoutDetails?.reference ||
      event.paymentDetails?.failureReason ||
      event.paymentDetails?.status ||
      null
    );
  }
}
