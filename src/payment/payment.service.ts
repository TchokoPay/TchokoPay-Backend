import { Injectable } from '@nestjs/common';
import { FlowHelper } from './flows/flow.helper.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { NetwalletpayProvider } from './providers/netwalletpay.provider.js';

@Injectable()
export class PaymentService {
  constructor(
    private flowHelper: FlowHelper,
    private netwalletpayProvider: NetwalletpayProvider,
  ) {}

  async processPayment(userId: string, dto: CreatePaymentDto) {
    return this.flowHelper.execute(userId, dto);
  }

  async verifyProviders(paymentType: string, method: string, country: string) {
    return this.netwalletpayProvider.verifyProviderConfig(
      paymentType as 'COLLECTION' | 'PAYOUT',
      method,
      country,
    );
  }
}