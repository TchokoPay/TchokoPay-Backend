import { Module } from '@nestjs/common';
import { MerchantController } from './merchant.controller.js';
import { PaymentLinkPublicController } from './payment-link-public.controller.js';
import { MerchantService } from './merchant.service.js';
import { MerchantPaymentLinkService } from './merchant-payment-link.service.js';
import { MerchantCashoutService } from './merchant-cashout.service.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { QuoteModule } from '../quote/quote.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [PrismaModule, UsersModule, QuoteModule, PaymentModule, EmailModule],
  controllers: [MerchantController, PaymentLinkPublicController],
  providers: [MerchantService, MerchantPaymentLinkService, MerchantCashoutService],
  exports: [MerchantService, MerchantPaymentLinkService, MerchantCashoutService],
})
export class MerchantModule {}
