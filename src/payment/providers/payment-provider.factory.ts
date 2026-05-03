import { Injectable, Logger } from '@nestjs/common';
import { MomoProvider } from './momo.provider.js';
import { LightningProvider } from './lightning.provider.js';
import { OrangeProvider } from './orange.provider.js';
import { BankProvider } from './bank.provider.js';
import { CryptoProvider } from './crypto.provider.js';
import { NetwalletpayProvider } from './netwalletpay.provider.js';

/**
 * PaymentProviderFactory
 *
 * Single routing point for all payment execution.
 * Each aggregator registers itself via its `isSupported()` check; the factory
 * tries them in priority order and falls back to method-level defaults.
 *
 * ── Adding a new aggregator ───────────────────────────────────────────────────
 * 1. Create `src/payment/providers/<name>.provider.ts` implementing PaymentProvider
 * 2. Register it as a provider in `payment.module.ts`
 * 3. Inject it here and add a `shouldUse<Name>()` check in `getProvider()`
 * 4. Add its aggregator row to the DB via the seed (prisma/seed.ts → aggregators[])
 * 5. Add its provider rows to DB with `aggregatorId = <name>`
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);

  constructor(
    // Thin protocol adapters (used when no aggregator handles the method)
    private momo: MomoProvider,
    private lightning: LightningProvider,
    private orange: OrangeProvider,
    private bank: BankProvider,
    private crypto: CryptoProvider,

    // Aggregators — each owns its DB provider rows and handles routing internally
    private netwalletpay: NetwalletpayProvider,
    // Future: private blink: BlinkProvider        (aggregator code: 'blink')
    // Future: private stripe: StripeProvider       (aggregator code: 'stripe')
    // Future: private flutterwave: FlutterwaveProvider (aggregator code: 'flutterwave')
  ) {}

  /**
   * Returns the correct provider implementation for a payment attempt.
   *
   * Aggregator priority (first match wins):
   *   1. Netwalletpay  — MOMO / ORANGE / CARD / BANK in supported African countries
   *   2. (future)       — additional aggregators added here
   *   3. Direct adapters — Lightning (Blink SDK), Crypto
   */
  getProvider(method: string, country?: string) {
    const normalized = method?.toUpperCase();

    // ── Aggregator routing ─────────────────────────────────────────────────────

    if (country && this.netwalletpay.isSupported(country, normalized)) {
      this.logger.log(`🔄 Routing to Netwalletpay: ${country} - ${normalized}`);
      return this.netwalletpay;
    }

    // ── Direct protocol adapters ───────────────────────────────────────────────

    switch (normalized) {
      case 'LIGHTNING':
        return this.lightning;

      case 'BTC':
      case 'CRYPTO':
      case 'USDT':
        return this.crypto;

      // Legacy fallbacks (used only when Netwalletpay does not support the country)
      case 'MOMO':
        return this.momo;
      case 'ORANGE':
        return this.orange;
      case 'BANK':
        return this.bank;

      default:
        throw new Error(
          `Unsupported payment method: ${method}. ` +
            `If this is a new aggregator, add it to PaymentProviderFactory.`,
        );
    }
  }
}
