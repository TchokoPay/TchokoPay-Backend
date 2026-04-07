import { Injectable } from '@nestjs/common';
import { PaymentProvider } from './base/payment-provider.interface.js';
import { PayinDto, PayoutDto } from './base/types.js';

@Injectable()
export class BankProvider implements PaymentProvider {
  async payin(data: PayinDto) {
    console.log('🏦 BANK PAYIN', data);
    return { status: 'SUCCESS' };
  }

  async payout(data: PayoutDto) {
    console.log('🏦 BANK PAYOUT', data);
    // Bank transfers typically take 1-3 business days
    return { status: 'PENDING_SETTLEMENT' };
  }
}
