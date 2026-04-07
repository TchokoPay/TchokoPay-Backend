import { Injectable } from '@nestjs/common';
import { PaymentProvider } from './base/payment-provider.interface.js';
import { PayinDto, PayoutDto } from './base/types.js';

@Injectable()
export class MomoProvider implements PaymentProvider {
  async payin(data: PayinDto) {
    console.log('💰 MOMO PAYIN', data);
    return { status: 'SUCCESS' };
  }

  async payout(data: PayoutDto) {
    console.log('💸 MOMO PAYOUT', data);
    return { status: 'SUCCESS' };
  }
}