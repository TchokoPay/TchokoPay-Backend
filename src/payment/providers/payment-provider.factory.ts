import { Injectable, Logger } from '@nestjs/common';
import { MomoProvider } from './momo.provider.js';
import { LightningProvider } from './lightning.provider.js';
import { OrangeProvider } from './orange.provider.js';
import { BankProvider } from './bank.provider.js';
import { CryptoProvider } from './crypto.provider.js';
import { NetwalletpayProvider } from './netwalletpay.provider.js';

@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  constructor(
    private momo: MomoProvider,
    private lightning: LightningProvider,
    private orange: OrangeProvider,
    private bank: BankProvider,
    private crypto: CryptoProvider,
    private netwalletpay: NetwalletpayProvider,
  ) {}

  getProvider(method: string, country?: string, paymentType?: 'COLLECTION' | 'PAYOUT') {
    const normalized = method?.toUpperCase();

    // Route to netwalletpay for supported countries/methods
    if (country && this.shouldUseNetwalletpay(country, normalized)) {
      this.logger?.log(`🔄 Routing to Netwalletpay: ${country} - ${normalized}`);
      return this.netwalletpay;
    }

    // Fallback to existing providers
    switch (normalized) {
      case 'MOMO':
        return this.momo;
      case 'LIGHTNING':
        return this.lightning;
      case 'ORANGE':
        return this.orange;
      case 'BANK':
        return this.bank;
      case 'BTC':
      case 'CRYPTO':
      case 'USDT':
        return this.crypto;

      default:
        throw new Error(`Unsupported provider: ${method}`);
    }
  }

  /**
   * Determine if we should use netwalletpay for this country/method combination
   */
  private shouldUseNetwalletpay(country: string, method: string): boolean {
    return this.netwalletpay.isSupported(country, method);
  }
}