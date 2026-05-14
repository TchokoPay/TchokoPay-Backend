import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getWebsocketCorsOrigins } from '../../config/cors.config.js';
import type {
  PaymentCompleteEvent,
  PaymentLifecycleStage,
  WebhookPaymentEvent,
} from '../services/payment-event.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

interface SocketAuthPayload {
  accessToken?: string;
  deviceId?: string;
  sessionId?: string;
}

interface SocketJwtPayload {
  sub: string;
  identifier: string;
}

function deriveLifecycleStage(invoice: {
  status: string;
  attempts: Array<{ status: string }>;
  payout: null | {
    status: string;
    attempts: Array<{ status: string }>;
  };
}): PaymentLifecycleStage {
  if (invoice.status === 'FAILED' || invoice.status === 'CANCELLED') {
    return 'FAILED';
  }

  if (
    invoice.payout?.status === 'SUCCESS' ||
    invoice.payout?.attempts[0]?.status === 'SUCCESS' ||
    invoice.status === 'SUCCESS'
  ) {
    return 'COMPLETED';
  }

  if (
    invoice.payout?.status === 'FAILED' ||
    invoice.payout?.attempts[0]?.status === 'FAILED'
  ) {
    return 'FAILED';
  }

  if (
    invoice.payout?.status === 'PROCESSING' ||
    invoice.payout?.attempts[0]?.status === 'PROCESSING'
  ) {
    return 'PAYOUT_PROCESSING';
  }

  if (invoice.attempts[0]?.status === 'SUCCESS') {
    return 'PAYER_CONFIRMED';
  }

  return 'AWAITING_PAYER';
}

/**
 * Payment WebSocket Gateway — namespace /payments
 *
 * Rooms:
 *   user:{userId}             → authenticated user's personal feed
 *   invoice:{invoiceReference} → anyone watching a specific invoice (payer, payee, guest)
 *
 * Events emitted to clients:
 *   payment:complete  → PaymentCompleteEvent  (initiation + confirmation + payout)
 *   webhook:payment   → WebhookPaymentEvent   (raw provider callback forwarded)
 *
 * Events clients send:
 *   subscribe:invoice   { invoiceReference }
 *   unsubscribe:invoice { invoiceReference }
 */
@WebSocketGateway({
  cors: {
    origin: getWebsocketCorsOrigins(),
    credentials: true,
  },
  namespace: 'payments',
})
@Injectable()
export class PaymentGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PaymentGateway.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  @WebSocketServer()
  server!: Server;

  // userId  → Set of socketIds
  private userConnections = new Map<string, Set<string>>();
  // invoiceReference → Set of socketIds
  private invoiceSubscriptions = new Map<string, Set<string>>();

  // ─── Connection lifecycle ─────────────────────────────────────────────────

  async handleConnection(client: Socket) {
    const auth = (client.handshake.auth ?? {}) as SocketAuthPayload;
    const deviceId = auth.deviceId?.trim() || undefined;
    const sessionId = auth.sessionId?.trim() || client.id;
    const connectedAt = new Date().toISOString();
    let userId: string | undefined;

    if (auth.accessToken) {
      try {
        const payload = await this.jwtService.verifyAsync<SocketJwtPayload>(
          auth.accessToken,
          { secret: process.env.JWT_ACCESS_SECRET },
        );
        userId = payload.sub;
      } catch {
        client.emit('socket:auth:error', {
          message: 'Invalid or expired access token',
        });
        client.disconnect(true);
        return;
      }
    }

    client.data.sessionId = sessionId;
    client.data.deviceId = deviceId;
    client.data.userId = userId;
    client.data.connectedAt = connectedAt;

    if (userId) {
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(client.id);
      void client.join(`user:${userId}`);
      this.logger.log(
        `WS connected: ${client.id} | user:${userId} | session:${sessionId} | device:${deviceId ?? 'unknown'}`,
      );
    } else {
      this.logger.log(
        `WS connected: ${client.id} (guest) | session:${sessionId} | device:${deviceId ?? 'unknown'}`,
      );
    }

    client.emit('socket:ready', {
      socketId: client.id,
      userId: userId ?? null,
      sessionId,
      deviceId: deviceId ?? null,
      connectedAt,
    });
  }

  handleDisconnect(client: Socket) {
    const sid = client.id;
    this.logger.log(`WS disconnected: ${sid}`);

    for (const [userId, sockets] of this.userConnections.entries()) {
      if (sockets.has(sid)) {
        sockets.delete(sid);
        if (sockets.size === 0) this.userConnections.delete(userId);
      }
    }
    for (const [ref, sockets] of this.invoiceSubscriptions.entries()) {
      if (sockets.has(sid)) {
        sockets.delete(sid);
        if (sockets.size === 0) this.invoiceSubscriptions.delete(ref);
      }
    }
  }

  // ─── Client messages ──────────────────────────────────────────────────────

  /** Client subscribes to a specific invoice's status stream. */
  @SubscribeMessage('subscribe:invoice')
  async handleSubscribeInvoice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { invoiceReference: string },
  ) {
    const invoiceReference = data?.invoiceReference?.trim();
    if (!invoiceReference) return;

    const invoice = await this.prisma.paymentInvoice.findUnique({
      where: { reference: invoiceReference },
      include: {
        currency: true,
        attempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        payout: {
          include: {
            attempts: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!invoice) {
      client.emit('subscribe:invoice:error', {
        invoiceReference,
        message: 'Invoice not found',
      });
      return;
    }

    if (!this.invoiceSubscriptions.has(invoiceReference)) {
      this.invoiceSubscriptions.set(invoiceReference, new Set());
    }
    this.invoiceSubscriptions.get(invoiceReference)!.add(client.id);
    void client.join(`invoice:${invoiceReference}`);
    this.logger.log(`invoice subscribe: ${client.id} -> invoice:${invoiceReference}`);

    client.emit('subscribe:invoice:ok', { invoiceReference });
    const stage = deriveLifecycleStage(invoice);
    client.emit('invoice:snapshot', {
      invoiceReference: invoice.reference,
      status: invoice.status,
      stage,
      paymentMethod: invoice.paymentMethod,
      payoutMethod: invoice.payoutMethod,
      amount: Number(invoice.amount),
      currency: invoice.currency.code,
      expiresAt: invoice.expiresAt,
      updatedAt: invoice.updatedAt,
      latestAttempt: invoice.attempts[0]
        ? {
            status: invoice.attempts[0].status,
            provider: invoice.attempts[0].provider,
            externalRef: invoice.attempts[0].externalRef,
            failureReason: invoice.attempts[0].failureReason,
          }
        : null,
      payout: invoice.payout
        ? {
            status: invoice.payout.status,
            updatedAt: invoice.payout.updatedAt,
          }
        : null,
      latestPayoutAttempt: invoice.payout?.attempts[0]
        ? {
            status: invoice.payout.attempts[0].status,
            provider: invoice.payout.attempts[0].provider,
            externalRef: invoice.payout.attempts[0].externalRef,
          }
        : null,
    });
  }

  /** Client unsubscribes from an invoice's status stream. */
  @SubscribeMessage('unsubscribe:invoice')
  handleUnsubscribeInvoice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { invoiceReference: string },
  ) {
    const { invoiceReference } = data;
    this.invoiceSubscriptions.get(invoiceReference)?.delete(client.id);
    void client.leave(`invoice:${invoiceReference}`);
    this.logger.log(`invoice unsubscribe: ${client.id} <- invoice:${invoiceReference}`);
  }

  // ─── Internal event listeners ─────────────────────────────────────────────

  /**
   * Fired by PaymentEventService for every status change:
   * initiated, payin confirmed, payout dispatched, payout confirmed.
   */
  @OnEvent('payment.complete')
  handlePaymentComplete(event: PaymentCompleteEvent) {
    this.logger.log(
      `payment:complete -> ${event.invoiceReference} [${event.status}]`,
    );

    const payload = {
      invoiceReference: event.invoiceReference,
      status: event.status,
      stage: event.stage,
      paymentMethod: event.paymentMethod,
      payoutMethod: event.payoutMethod,
      amount: event.amount,
      currency: event.currency,
      paymentDetails: event.paymentDetails,
      payoutDetails: event.payoutDetails,
      timestamp: event.timestamp,
    };

    // → user room (authenticated payer / payee)
    if (event.userId) {
      this.server.to(`user:${event.userId}`).emit('payment:complete', payload);
    }

    // → invoice room (payer, payee, or guest who opened the pay page)
    this.server
      .to(`invoice:${event.invoiceReference}`)
      .emit('payment:complete', payload);

    // → global (admin dashboards)
    this.server.emit('payment:global', {
      type: 'payment.complete',
      invoiceReference: event.invoiceReference,
      status: event.status,
      userId: event.userId,
      timestamp: event.timestamp,
    });
  }

  /**
   * Fired by PaymentEventService when a provider webhook fires.
   * Routes by invoiceReference — the same key clients subscribe with.
   * (invoiceId is a UUID and is different from invoiceReference.)
   */
  @OnEvent('webhook.payment')
  handleWebhookPayment(event: WebhookPaymentEvent) {
    this.logger.log(
      `webhook:payment -> invoice:${event.invoiceReference} | ${event.provider} | ${event.eventType}`,
    );

    const payload = {
      provider: event.provider,
      eventType: event.eventType,
      stage: event.stage,
      invoiceId: event.invoiceId,
      invoiceReference: event.invoiceReference,
      externalRef: event.externalRef,
      status: event.status,
      amount: event.amount,
      currency: event.currency,
      failureReason: event.failureReason,
      timestamp: event.timestamp,
    };

    this.server
      .to(`invoice:${event.invoiceReference}`)
      .emit('webhook:payment', payload);

    this.server.emit('payment:global', { type: 'webhook.payment', ...payload });
  }
}
