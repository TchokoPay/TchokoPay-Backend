import { Injectable } from '@nestjs/common';
import { PaymentProvider } from './base/payment-provider.interface.js';
import { PayinDto, PayoutDto } from './base/types.js';

@Injectable()
export class OrangeProvider implements PaymentProvider {
  async payin(data: PayinDto) {
    console.log('🟠 Orange PAYIN:', data);

    return { status: 'SUCCESS' };
  }

  async payout(data: PayoutDto) {
    console.log('🟠 Orange PAYOUT:', data);

    return { status: 'SUCCESS' };
  }
}