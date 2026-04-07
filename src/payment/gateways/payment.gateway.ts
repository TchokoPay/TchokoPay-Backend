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
import type {
  PaymentCompleteEvent,
  WebhookPaymentEvent,
} from '../services/payment-event.service.js';

/**
 * Payment WebSocket Gateway
 * Broadcasts real-time payment status updates to connected clients
 *
 * Clients can:
 * 1. Listen to their own payment updates: `payment:${userId}`
 * 2. Listen to global payment events (admin dashboard): `payment:global`
 * 3. Subscribe to specific invoice status: `invoice:${invoiceReference}`
 */
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: 'payments',
})
@Injectable()
export class PaymentGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PaymentGateway.name);

  @WebSocketServer()
  server!: Server;

  // Track connected users and their invoice subscriptions
  private userConnections = new Map<string, Set<string>>(); // userId -> Set of socketIds
  private invoiceSubscriptions = new Map<string, Set<string>>(); // invoiceRef -> Set of socketIds

  /**
   * Handle client connection
   * Client should send userId after connecting for routing
   */
  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    const socketId = client.id;

    if (userId) {
      // Track this user's connection
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(socketId);
      console.log(`✅ User ${userId} connected (socket: ${socketId})`);

      // Join user-specific room for targeted broadcasts
      client.join(`user:${userId}`);
    }

    console.log(
      `🔗 WebSocket connected: ${socketId} [Total: ${this.server?.sockets?.sockets?.size || 0}]`,
    );
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(client: Socket) {
    const socketId = client.id;
    console.log(
      `🔌 WebSocket disconnected: ${socketId} [Total: ${this.server?.sockets?.sockets?.size || 0}]`,
    );

    // Clean up user tracking
    for (const [userId, sockets] of this.userConnections.entries()) {
      if (sockets && sockets.has(socketId)) {
        sockets.delete(socketId);
        if (sockets.size === 0) {
          this.userConnections.delete(userId);
        }
      }
    }

    // Clean up invoice subscriptions
    for (const [invoiceRef, sockets] of this.invoiceSubscriptions.entries()) {
      if (sockets.has(socketId)) {
        sockets.delete(socketId);
        if (sockets.size === 0) {
          this.invoiceSubscriptions.delete(invoiceRef);
        }
      }
    }
  }

  /**
   * Client subscribes to specific invoice updates
   * Useful for payment status polling/websocket hybrid
   */
  @SubscribeMessage('subscribe:invoice')
  handleSubscribeInvoice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { invoiceReference: string },
  ) {
    const { invoiceReference } = data;
    const socketId = client.id;

    if (!this.invoiceSubscriptions.has(invoiceReference)) {
      this.invoiceSubscriptions.set(invoiceReference, new Set());
    }
    this.invoiceSubscriptions.get(invoiceReference)!.add(socketId);

    // Join invoice-specific room
    client.join(`invoice:${invoiceReference}`);

    console.log(`📋 Client ${socketId} subscribed to invoice: ${invoiceReference}`);

    // Send confirmation
    client.emit('subscribe:invoice:ok', { invoiceReference });
  }

  /**
   * Client unsubscribes from invoice
   */
  @SubscribeMessage('unsubscribe:invoice')
  handleUnsubscribeInvoice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { invoiceReference: string },
  ) {
    const { invoiceReference } = data;
    const socketId = client.id;

    this.invoiceSubscriptions.get(invoiceReference)?.delete(socketId);
    client.leave(`invoice:${invoiceReference}`);

    console.log(
      `📋 Client ${socketId} unsubscribed from invoice: ${invoiceReference}`,
    );
  }

  /**
   * Listen to payment.complete events from PaymentEventService
   * Broadcast to user + all invoice subscribers
   */
  @OnEvent('payment.complete')
  async handlePaymentComplete(event: PaymentCompleteEvent) {
    console.log(
      `📡 Broadcasting payment.complete: ${event.invoiceReference} [Status: ${event.status}]`,
    );

    // Broadcast to user if they're connected
    if (event.userId) {
      this.server.to(`user:${event.userId}`).emit('payment:complete', {
        invoiceReference: event.invoiceReference,
        status: event.status,
        paymentMethod: event.paymentMethod,
        payoutMethod: event.payoutMethod,
        amount: event.amount,
        currency: event.currency,
        paymentDetails: event.paymentDetails,
        payoutDetails: event.payoutDetails,
        timestamp: event.timestamp,
      });
    }

    // Broadcast to all invoice subscribers (multiple users tracking same invoice)
    this.server
      .to(`invoice:${event.invoiceReference}`)
      .emit('payment:complete', {
        invoiceReference: event.invoiceReference,
        status: event.status,
        paymentMethod: event.paymentMethod,
        payoutMethod: event.payoutMethod,
        amount: event.amount,
        currency: event.currency,
        paymentDetails: event.paymentDetails,
        payoutDetails: event.payoutDetails,
        timestamp: event.timestamp,
      });

    // Global broadcast for dashboards
    this.server.emit('payment:global', {
      type: 'payment.complete',
      invoiceReference: event.invoiceReference,
      status: event.status,
      userId: event.userId,
      timestamp: event.timestamp,
    });
  }

  /**
   * Listen to webhook.payment events from PaymentEventService
   * Broadcast when provider confirms/rejects payment
   */
  @OnEvent('webhook.payment')
  async handleWebhookPayment(event: WebhookPaymentEvent) {
    console.log(
      `📡 Broadcasting webhook.payment from ${event.provider}: ${event.eventType}`,
    );

    // Broadcast to users subscribed to this invoice
    this.server.to(`invoice:${event.invoiceId}`).emit('webhook:payment', {
      provider: event.provider,
      eventType: event.eventType,
      invoiceId: event.invoiceId,
      externalRef: event.externalRef,
      status: event.status,
      amount: event.amount,
      currency: event.currency,
      failureReason: event.failureReason,
      timestamp: event.timestamp,
    });
  }

  /**
   * Send payment status to specific client
   * Useful for direct responses or targeted updates
   */
  broadcastToUser(userId: string, event: PaymentCompleteEvent) {
    this.server.to(`user:${userId}`).emit('payment:update', event);
  }

  /**
   * Send to all connected clients (admin dashboard)
   */
  broadcastGlobal(eventType: string, data: any) {
    this.server.emit(`payment:${eventType}`, data);
  }
}
