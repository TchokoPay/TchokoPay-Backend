import { PayinDto, PayoutDto } from './types.js';

export interface PaymentProvider {
  payin(data: PayinDto): Promise<any>;
  payout(data: PayoutDto): Promise<any>;
}