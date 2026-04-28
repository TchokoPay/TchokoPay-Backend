/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { PaymentService } from './payment.service.js';
import { PaymentController } from './payment.controller.js';
import { WebhookController } from './webhooks/webhook.controller.js';

import { PrismaModule } from '../../prisma/prisma.module.js';
import { QuoteModule } from '../quote/quote.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthModule } from '../auth/auth.module.js';

// Flow classes
import { FlowHelper } from './flows/flow.helper.js';
import { DirectFlow } from './flows/direct.flow.js';
import { QrFlow } from './flows/qr.flow.js';
import { RequestFlow } from './flows/request.flow.js';

// Use cases
import { ProcessPaymentUseCase } from './use-cases/process-payment.usecase.js';
import { CreateRequestUseCase } from './use-cases/create-request.usecase.js';
import { PayRequestUseCase } from './use-cases/pay-request.usecase.js';

// Providers
import { PaymentProviderFactory } from './providers/payment-provider.factory.js';
import { MomoProvider } from './providers/momo.provider.js';
import { LightningProvider } from './providers/lightning.provider.js';
import { OrangeProvider } from './providers/orange.provider.js';
import { BankProvider } from './providers/bank.provider.js';
import { CryptoProvider } from './providers/crypto.provider.js';
import { NetwalletpayProvider } from './providers/netwalletpay.provider.js';

// Services
import { PhoneResolutionService } from './services/phone-resolution.service.js';
import { BlinkApiService } from './providers/services/blink-api.service.js';
import { PaymentEventService } from './services/payment-event.service.js';
import { PayoutExecutorService } from './services/payout-executor.service.js';
import { PaymentPollingService } from './services/payment-polling.service.js';
import { PaymentGateway } from './gateways/payment.gateway.js';

@Module({
  imports: [
    PrismaModule,
    QuoteModule,
    UsersModule,
    AuthModule,
    HttpModule,
    ConfigModule,
    EventEmitterModule.forRoot(),
  ],
  controllers: [PaymentController, WebhookController],
  providers: [
    PaymentService,
    // Flow classes
    FlowHelper,
    DirectFlow,
    QrFlow,
    RequestFlow,
    // Use cases
    ProcessPaymentUseCase,
    CreateRequestUseCase,
    PayRequestUseCase,
    // Providers
    PaymentProviderFactory,
    MomoProvider,
    LightningProvider,
    OrangeProvider,
    BankProvider,
    CryptoProvider,
    NetwalletpayProvider,
    // Services
    PhoneResolutionService,
    BlinkApiService,
    PaymentEventService,
    PayoutExecutorService,
    PaymentPollingService,
    // WebSocket Gateway
    PaymentGateway,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
