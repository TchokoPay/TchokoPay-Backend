import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export type PaymentLifecycleStage =
  | 'AWAITING_PAYER'
  | 'PAYER_CONFIRMED'
  | 'PAYOUT_PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export interface PaymentCompleteEvent {
  invoiceId: string;
  invoiceReference: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'PROCESSING';
  stage: PaymentLifecycleStage;
  paymentMethod: string;
  payoutMethod: string;
  amount: number;
  currency: string;
  paymentDetails?: {
    status: string;
    invoiceId?: string;
    transactionId?: string;
    paymentRequest?: string;
    expiresAt?: string;
    address?: string;
    paymentHash?: string;
    failureReason?: string;
  };
  payoutDetails?: {
    status: string;
    transactionId?: string;
    reference?: string;
    failureReason?: string;
  };
  timestamp: Date;
  userId?: string;
}

export interface WebhookPaymentEvent {
  provider: string;
  eventType: 'payment.confirmed' | 'payment.failed' | 'payment.pending';
  invoiceId: string;
  /** E.g. "INV-1774421373834" — used for WebSocket room routing */
  invoiceReference: string;
  stage?: PaymentLifecycleStage;
  externalRef?: string;
  status: string;
  amount?: number;
  currency?: string;
  failureReason?: string;
  payload: unknown;
  timestamp: Date;
}

/**
 * Centralises all payment events so they can reach the WebSocket gateway,
 * admin dashboards, and any future subscribers without tight coupling.
 *
 * Emits when:
 *  - A payment is initiated / completes / fails  (payment.complete)
 *  - A provider webhook is received              (webhook.payment)
 *  - A payout is confirmed                       (payment.complete with payoutDetails)
 */
@Injectable()
export class PaymentEventService {
  constructor(private eventEmitter: EventEmitter2) {}

  /**
   * Emit after payment processing (Lightning invoice created, MOMO request sent, etc.)
   * Also used when payout is confirmed.
   */
  emitPaymentComplete(event: PaymentCompleteEvent) {
    console.log(
      `📤 payment.complete → ${event.invoiceReference} [${event.status}]`,
    );
    this.eventEmitter.emit('payment.complete', event);
  }

  /**
   * Emit when a provider webhook fires (Blink confirmed, Netwalletpay callback, etc.)
   * invoiceReference is required so the gateway can route to the correct room.
   */
  emitWebhookPayment(event: WebhookPaymentEvent) {
    console.log(
      `📤 webhook.payment → ${event.invoiceReference} | ${event.provider} | ${event.eventType}`,
    );
    this.eventEmitter.emit('webhook.payment', event);
  }

  /**
   * Send a targeted update to a specific authenticated user.
   * The gateway listens on user:${userId} and forwards to the connected client.
   */
  notifyUser(userId: string, event: PaymentCompleteEvent) {
    if (!userId?.trim()) {
      console.log(
        `📤 notify user skipped (guest/no userId) → ${event.invoiceReference} [${event.status}]`,
      );
      this.eventEmitter.emit('payment:global', event);
      return;
    }

    console.log(
      `📤 notify user ${userId} → ${event.invoiceReference} [${event.status}]`,
    );
    // Gateway picks this up via @OnEvent('payment.complete') since event has userId
    this.eventEmitter.emit('payment.complete', { ...event, userId });
    // Also emit globally for admin dashboards
    this.eventEmitter.emit('payment:global', event);
  }
}
