import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import type { Redis as RedisType } from 'ioredis';
import { AuditModule } from './audit/audit.module.js';
import { RedisModule } from './redis/redis.module.js';
import { REDIS_CLIENT } from './redis/redis.constants.js';
import { ThrottlerStorageRedisService } from './redis/throttler-storage-redis.service.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { GoogleModule } from './google/google.module.js';
import { UsersModule } from './users/users.module.js';
import { ContactsModule } from './contacts/contacts.module.js';
import { OtpModule } from './otp/otp.module.js';
import { KycModule } from './kyc/kyc.module.js';
import { CurrencyModule } from './currency/currency.module.js';
import { QuoteController } from './quote/quote.controller.js';
import { QuoteService } from './quote/quote.service.js';
import { QuoteModule } from './quote/quote.module.js';
import { PricingService } from './pricing/pricing.service.js';
import { PricingModule } from './pricing/pricing.module.js';
import { PaymentIdentityController } from './payment-identity/payment-identity.controller.js';
import { PaymentIdentityService } from './payment-identity/payment-identity.service.js';
import { PaymentIdentityModule } from './payment-identity/payment-identity.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { AdminModule } from './admin/admin.module.js';
import { EmailModule } from './email/email.module.js';

@Module({
  imports: [
    RedisModule,
    AuditModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redis: RedisType) => ({
        throttlers: [
          { name: 'global', ttl: 60_000, limit: 200 },
          { name: 'auth', ttl: 60_000, limit: 10 },
        ],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    PrismaModule,
    AuthModule,
    GoogleModule,
    UsersModule,
    ContactsModule,
    OtpModule,
    KycModule,
    CurrencyModule,
    QuoteModule,
    PricingModule,
    PaymentIdentityModule,
    PaymentModule,
    AdminModule,
    EmailModule,
  ],
  controllers: [AppController, QuoteController, PaymentIdentityController],
  providers: [
    AppService,
    QuoteService,
    PricingService,
    PaymentIdentityService,
    // Applies ThrottlerGuard globally to every route
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
