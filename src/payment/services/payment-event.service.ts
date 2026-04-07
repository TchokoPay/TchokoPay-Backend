import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface PaymentCompleteEvent {
  invoiceId: string;
  invoiceReference: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  paymentMethod: string;
  payoutMethod: string;
  amount: number;
  currency: string;
  paymentDetails?: {
    status: string;
    invoiceId?: string;
    paymentRequest?: string;
    expiresAt?: string;
    address?: string;
    paymentHash?: string;
  };
  payoutDetails?: {
    status: string;
    transactionId?: string;
    reference?: string;
  };
  timestamp: Date;
  userId?: string;
}

export interface WebhookPaymentEvent {
  provider: string;
  eventType: 'payment.confirmed' | 'payment.failed' | 'payment.pending';
  invoiceId: string;
  externalRef?: string;
  status: string;
  amount?: number;
  currency?: string;
  failureReason?: string;
  payload: any;
  timestamp: Date;
}

/**
 * Payment Event Service
 * Centralizes payment events for WebSocket broadcasting
 * Emits when:
 * - Payment is completed (success/failure)
 * - Webhook is received from provider (Blink, MOMO, etc.)
 */
@Injectable()
export class PaymentEventService {
  constructor(private eventEmitter: EventEmitter2) {}

  /**
   * Emit when payment completes (immediately after processing)
   * Sent when: Lightning invoice created, MOMO processed, etc.
   */
  async emitPaymentComplete(event: PaymentCompleteEvent) {
    console.log(
      `📤 Emitting payment.complete event for invoice: ${event.invoiceReference}`,
    );
    this.eventEmitter.emit('payment.complete', event);
  }

  /**
   * Emit when webhook is received from provider
   * Sent when: Blink confirms payment, MOMO sends callback, etc.
   */
  async emitWebhookPayment(event: WebhookPaymentEvent) {
    console.log(
      `📤 Emitting webhook.payment event from ${event.provider}: ${event.eventType}`,
    );
    this.eventEmitter.emit('webhook.payment', event);
  }

  /**
   * Emit to notify specific user of their payment status
   * Used by WebSocket gateway to know which rooms to broadcast to
   */
  async notifyUser(userId: string, event: PaymentCompleteEvent) {
    console.log(`📤 Broadcasting to user ${userId}:`, event.invoiceReference);
    this.eventEmitter.emit(`payment:${userId}`, event);
    // Also emit globally for admin dashboards
    this.eventEmitter.emit('payment:global', event);
  }
}
