import { Module } from '@nestjs/common';
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

@Module({
  imports: [
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
    PaymentModule
  ],
  controllers: [AppController, QuoteController, PaymentIdentityController],
  providers: [AppService, QuoteService, PricingService, PaymentIdentityService],
})
export class AppModule {}
