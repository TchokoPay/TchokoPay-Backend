import {
  Controller,
  Post,
  Body,
  BadRequestException,
  Headers,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PaymentEventService } from '../services/payment-event.service.js';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransactionStatus } from '@prisma/client';

/**
 * Webhook Controller for Payment Providers
 * Receives callbacks from Blink, MOMO, Orange, etc.
 * Processes payment confirmations and updates invoice status
 */
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private paymentEventService: PaymentEventService,
  ) {}

  /**
   * Blink Lightning Payment Webhook
   * Called when Lightning invoice is paid or expires
   *
   * Webhook Signature Verification:
   * Header: x-blink-signature = HMAC-SHA256(payload, BLINK_WEBHOOK_SECRET)
   *
   * Example payload:
   * {
   *   "type": "invoice.completed",
   *   "data": {
   *     "invoiceId": "7bc0e87c88c4f181b4723b50bf732b710a65580b3ab6576309cb74a86a2de02a",
   *     "status": "PAID",
   *     "amount": 101500,
   *     "currency": "SAT",
   *     "paymentHash": "...",
   *     "description": "INV-1774421373834"
   *   }
   * }
   */
  @Post('blink')
  @ApiOperation({
    summary: 'Blink Lightning Payment Webhook',
    description:
      'Endpoint for Blink to notify about Lightning invoice payment status',
  })
  @ApiBody({
    schema: {
      example: {
        type: 'invoice.completed',
        data: {
          invoiceId: 'invoice_id_here',
          status: 'PAID',
          amount: 101500,
          currency: 'SAT',
          paymentHash: 'payment_hash_here',
          description: 'INV-1774421373834',
        },
      },
    },
  })
  async handleBlinkWebhook(
    @Body() payload: any,
    @Headers('x-blink-signature') signature: string,
  ) {
    console.log('🔔 Received Blink webhook:', payload.type);

    // ============================
    // 1. VERIFY SIGNATURE (OPTIONAL FOR NOW)
    // ============================
    // TODO: Verify HMAC-SHA256 signature in production
    // const blinkSecret = this.configService.get<string>('BLINK_WEBHOOK_SECRET');
    // if (!this.verifySignature(JSON.stringify(payload), signature, blinkSecret)) {
    //   throw new UnauthorizedException('Invalid webhook signature');
    // }

    // ============================
    // 2. IDEMPOTENCY CHECK - ensure we don't process same webhook twice
    // ============================
    const eventId = payload.data?.invoiceId || payload.id;
    if (!eventId) {
      throw new BadRequestException(
        'Missing invoiceId or event identifier in webhook',
      );
    }

    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: {
        eventId,
      },
    });

    if (existingEvent && existingEvent.processed) {
      console.log(
        `⏭️  Webhook already processed (idempotency): ${eventId}`,
      );
      return { acknowledged: true };
    }

    // ============================
    // 3. STORE WEBHOOK EVENT
    // ============================
    const webhookEvent = await this.prisma.webhookEvent.upsert({
      where: { eventId },
      create: {
        provider: 'blink',
        eventId,
        type: payload.type,
        payload,
        processed: false,
      },
      update: {
        payload,
      },
    });

    console.log(`✅ Webhook stored: ${eventId}`);

    // ============================
    // 4. PROCESS BASED ON EVENT TYPE
    // ============================
    try {
      switch (payload.type) {
        case 'invoice.completed':
        case 'invoice.paid':
          await this.handleInvoicePaid(payload);
          break;

        case 'invoice.expired':
        case 'invoice.failed':
          await this.handleInvoiceExpired(payload);
          break;

        default:
          console.warn(`⚠️ Unknown Blink webhook type: ${payload.type}`);
      }

      // ============================
      // 5. MARK AS PROCESSED
      // ============================
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processed: true },
      });

      console.log(`✅ Webhook processed successfully: ${eventId}`);

      return {
        success: true,
        message: 'Webhook processed',
      };
    } catch (error) {
      console.error(`❌ Error processing webhook ${eventId}:`, error);
      throw error;
    }
  }

  /**
   * Handle invoice paid event
   * Update PaymentAttempt status and emit event
   */
  private async handleInvoicePaid(payload: any) {
    const { invoiceId, status, amount, currency, paymentHash, description } =
      payload.data;

    console.log(
      `⚡ Processing Lightning invoice paid: ${invoiceId.substring(0, 16)}...`,
    );

    // Find PaymentAttempt by external reference
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        externalRef: invoiceId,
      },
      include: {
        invoice: true,
        currency: true,
      },
    });

    if (!attempt) {
      console.warn(
        `⚠️ PaymentAttempt not found for invoice: ${invoiceId}`,
      );
      return;
    }

    console.log(
      `✅ Found PaymentAttempt: ${attempt.id} for invoice: ${attempt.invoice.reference}`,
    );

    // ============================
    // UPDATE PAYMENT ATTEMPT
    // ============================
    const updatedAttempt = await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'SUCCESS',
        providerResponse: {
          ...payload.data,
          confirmedAt: new Date(),
        },
      },
    });

    // ============================
    // UPDATE INVOICE STATUS
    // ============================
    const updatedInvoice = await this.prisma.paymentInvoice.update({
      where: { id: attempt.invoice.id },
      data: {
        status: 'SUCCESS',
      },
    });

    console.log(
      `✅ Invoice updated to SUCCESS: ${updatedInvoice.reference}`,
    );

    // ============================
    // EMIT EVENT FOR WEBSOCKET
    // ============================
    await this.paymentEventService.emitWebhookPayment({
      provider: 'blink',
      eventType: 'payment.confirmed',
      invoiceId: attempt.invoice.id,
      externalRef: invoiceId,
      status: 'SUCCESS',
      amount: Number(amount),
      currency: currency,
      payload: payload.data,
      timestamp: new Date(),
    });

    // Emit to user WebSocket connection
    if (attempt.invoice.createdById) {
      await this.paymentEventService.notifyUser(
        attempt.invoice.createdById,
        {
          invoiceId: attempt.invoice.id,
          invoiceReference: attempt.invoice.reference,
          status: 'SUCCESS',
          paymentMethod: attempt.method,
          payoutMethod: attempt.invoice.payoutMethod,
          amount: Number(attempt.amount),
          currency: attempt.currency.id,
          paymentDetails: {
            status: 'PAID',
            invoiceId: invoiceId,
            paymentHash: paymentHash,
          },
          timestamp: new Date(),
        },
      );
    }
  }

  /**
   * Handle invoice expired/failed event
   * Update PaymentAttempt status to FAILED
   */
  private async handleInvoiceExpired(payload: any) {
    const { invoiceId, status, reason } = payload.data;

    console.log(`⚠️ Processing Lightning invoice expired/failed: ${invoiceId}`);

    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        externalRef: invoiceId,
      },
      include: {
        invoice: true,
      },
    });

    if (!attempt) {
      console.warn(`⚠️ PaymentAttempt not found for invoice: ${invoiceId}`);
      return;
    }

    // ============================
    // UPDATE TO FAILED
    // ============================
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'FAILED',
        failureReason: reason || status,
        providerResponse: payload.data,
      },
    });

    await this.prisma.paymentInvoice.update({
      where: { id: attempt.invoice.id },
      data: {
        status: 'FAILED',
      },
    });

    console.log(`❌ Invoice marked as FAILED: ${attempt.invoice.reference}`);

    // ============================
    // EMIT FAILURE EVENT
    // ============================
    await this.paymentEventService.emitWebhookPayment({
      provider: 'blink',
      eventType: 'payment.failed',
      invoiceId: attempt.invoice.id,
      externalRef: invoiceId,
      status: 'FAILED',
      failureReason: reason || status,
      payload: payload.data,
      timestamp: new Date(),
    });

    if (attempt.invoice.createdById) {
      await this.paymentEventService.notifyUser(
        attempt.invoice.createdById,
        {
          invoiceId: attempt.invoice.id,
          invoiceReference: attempt.invoice.reference,
          status: 'FAILED',
          paymentMethod: attempt.method,
          payoutMethod: attempt.invoice.payoutMethod,
          amount: Number(attempt.amount),
          currency: attempt.currency.id,
          timestamp: new Date(),
        },
      );
    }
  }

  /**
   * Verify HMAC-SHA256 signature (for production use)
   */
  private verifySignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    // Implementation would use crypto.createHmac
    // This is a placeholder - implement in production
    return true; // TODO: Implement proper signature verification
  }

  /**
   * Netwalletpay Webhook Handler
   * Processes payment status updates from Netwalletpay
   */
  @Post('netwalletpay')
  @ApiOperation({
    summary: 'Netwalletpay webhook for payment status updates',
    description: 'Receives payment confirmations from Netwalletpay'
  })
  async handleNetwalletpayWebhook(
    @Body() payload: any,
    @Headers('x-netwalletpay-signature') signature?: string,
  ) {
    console.log('🔄 Netwalletpay webhook received:', payload);

    let eventId: string = '';

    try {
      // ============================
      // 1. VERIFY SIGNATURE (Production)
      // ============================
      // const netwalletpaySecret = this.configService.get<string>('NETWALLETPAY_WEBHOOK_SECRET');
      // if (!this.verifySignature(JSON.stringify(payload), signature, netwalletpaySecret)) {
      //   throw new UnauthorizedException('Invalid webhook signature');
      // }

      // ============================
      // 2. IDEMPOTENCY CHECK
      // ============================
      eventId = payload.TransactionId || payload.transactionId || payload.reference || payload.id;
      if (!eventId) {
        throw new BadRequestException('Missing transaction identifier in Netwalletpay webhook');
      }

      const existingEvent = await this.prisma.webhookEvent.findUnique({
        where: { eventId },
      });

      if (existingEvent) {
        console.log(`⚠️ Duplicate Netwalletpay webhook: ${eventId}`);
        return { status: 'DUPLICATE' };
      }

      // ============================
      // 3. STORE WEBHOOK EVENT
      // ============================
      const webhookEvent = await this.prisma.webhookEvent.create({
        data: {
          eventId,
          provider: 'netwalletpay',
          eventType: payload.status || payload.eventType,
          payload,
          processed: false,
        },
      });

      // ============================
      // 4. PROCESS PAYMENT STATUS
      // ============================
      const status = payload.Status || payload.status;

      switch (status) {
        case 'SUCCESS':
        case 'COMPLETED':
          await this.handleNetwalletpayPaymentSuccess(payload);
          break;

        case 'FAILED':
        case 'CANCELLED':
        case 'TIMEOUT':
          await this.handleNetwalletpayPaymentFailed(payload);
          break;

        case 'PENDING':
          console.log(`⏳ Netwalletpay payment pending: ${eventId}`);
          break;

        default:
          console.warn(`⚠️ Unknown Netwalletpay status: ${status}`);
      }

      // ============================
      // 5. MARK AS PROCESSED
      // ============================
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processed: true },
      });

      return { status: 'OK' };

    } catch (error) {
      console.error(`❌ Error processing Netwalletpay webhook ${eventId}:`, error);
      throw error;
    }
  }

  /**
   * Handle successful Netwalletpay payment
   */
  private async handleNetwalletpayPaymentSuccess(payload: any) {
    const transactionId = payload.TransactionId || payload.transactionId;

    console.log(`✅ Processing Netwalletpay payment success: ${transactionId}`);

    // Find PaymentAttempt by external reference
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { externalRef: transactionId },
      include: { invoice: true },
    });

    if (!attempt) {
      console.warn(`⚠️ Payment attempt not found for Netwalletpay transaction: ${transactionId}`);
      return;
    }

    // Update attempt status
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: TransactionStatus.SUCCESS,
      },
    });

    // Update invoice status
    await this.prisma.paymentInvoice.update({
      where: { id: attempt.invoice.id },
      data: {
        status: TransactionStatus.SUCCESS,
      },
    });

    console.log(`✅ Netwalletpay payment updated to SUCCESS: ${attempt.invoice.reference}`);

    // ============================
    // EMIT EVENT FOR WEBSOCKET
    // ============================
    await this.paymentEventService.emitWebhookPayment({
      provider: 'netwalletpay',
      eventType: 'payment.confirmed',
      invoiceId: attempt.invoice.id,
      externalRef: transactionId,
      status: 'SUCCESS',
      amount: Number(attempt.amount),
      currency: attempt.currency,
      payload: payload,
      timestamp: new Date(),
    });

    // Notify user via WebSocket
    if (attempt.invoice.createdById) {
      await this.paymentEventService.notifyUser(
        attempt.invoice.createdById,
        {
          invoiceId: attempt.invoice.id,
          invoiceReference: attempt.invoice.reference,
          status: 'SUCCESS',
          paymentMethod: attempt.method,
          payoutMethod: attempt.invoice.payoutMethod,
          amount: Number(attempt.amount),
          currency: attempt.currency.id,
          paymentDetails: payload,
          timestamp: new Date(),
        },
      );
    }
  }

  /**
   * Handle failed Netwalletpay payment
   */
  private async handleNetwalletpayPaymentFailed(payload: any) {
    const transactionId = payload.TransactionId || payload.transactionId;
    const reason = payload.reason || payload.error || 'Payment failed';

    console.log(`❌ Processing Netwalletpay payment failed: ${transactionId} - ${reason}`);

    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { externalRef: transactionId },
      include: { invoice: true },
    });

    if (!attempt) {
      console.warn(`⚠️ Payment attempt not found for failed Netwalletpay transaction: ${transactionId}`);
      return;
    }

    // Update attempt status to FAILED
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: TransactionStatus.FAILED,
      },
    });

    // Update invoice status
    await this.prisma.paymentInvoice.update({
      where: { id: attempt.invoice.id },
      data: {
        status: TransactionStatus.FAILED,
      },
    });

    console.log(`❌ Netwalletpay payment marked as FAILED: ${attempt.invoice.reference}`);

    // ============================
    // EMIT FAILURE EVENT
    // ============================
    await this.paymentEventService.emitWebhookPayment({
      provider: 'netwalletpay',
      eventType: 'payment.failed',
      invoiceId: attempt.invoice.id,
      externalRef: transactionId,
      status: 'FAILED',
      failureReason: reason || payload.status,
      payload: payload,
      timestamp: new Date(),
    });

    // Notify user of failure
    if (attempt.invoice.createdById) {
      await this.paymentEventService.notifyUser(
        attempt.invoice.createdById,
        {
          invoiceId: attempt.invoice.id,
          invoiceReference: attempt.invoice.reference,
          status: 'FAILED',
          paymentMethod: attempt.method,
          payoutMethod: attempt.invoice.payoutMethod,
          amount: Number(attempt.amount),
          currency: attempt.currency.id,
          timestamp: new Date(),
        },
      );
    }
  }
}
