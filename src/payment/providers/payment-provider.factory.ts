import { Injectable, Logger } from '@nestjs/common';
import { MomoProvider } from './momo.provider.js';
import { LightningProvider } from './lightning.provider.js';
import { OrangeProvider } from './orange.provider.js';
import { BankProvider } from './bank.provider.js';
import { CryptoProvider } from './crypto.provider.js';
import { NetwalletpayProvider } from './netwalletpay.provider.js';
import { ZikoPayProvider } from './zikopay.provider.js';

/**
 * PaymentProviderFactory
 *
 * Priority-based routing through registered aggregators.
 * Aggregators are tried in DB priority order (lower number = tried first).
 *
 *   Priority 1 — Netwalletpay  (CM, KE, TZ, UG, NG, ZA)
 *   Priority 2 — ZikoPay       (CI, SN, BJ, TG, GH + fallback on overlap countries)
 *   Priority 10 — Blink        (Lightning / Bitcoin)
 *
 * Adding a new aggregator:
 *   1. Create src/payment/providers/<name>.provider.ts implementing PaymentProvider
 *   2. Inject it here in the constructor
 *   3. Add to the `aggregators` array with its code and desired priority
 *   4. Register in payment.module.ts
 *   5. Seed its aggregator row + providers in prisma/seed.ts
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);

  /** Ordered list of DB-backed aggregators. The factory tries them in order. */
  private readonly aggregators: Array<{
    code: string;
    priority: number;
    provider: { isSupported(country: string, method: string): boolean | Promise<boolean> };
  }>;

  constructor(
    private momo: MomoProvider,
    private lightning: LightningProvider,
    private orange: OrangeProvider,
    private bank: BankProvider,
    private crypto: CryptoProvider,
    private netwalletpay: NetwalletpayProvider,
    private zikopay: ZikoPayProvider,
  ) {
    // Sorted by priority ascending — first matching aggregator wins.
    // Priority values must match what is seeded in PaymentAggregator.priority.
    this.aggregators = [
      { code: 'netwalletpay', priority: 1,  provider: this.netwalletpay },
      { code: 'zikopay',      priority: 2,  provider: this.zikopay      },
    ].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Returns the correct provider for a payment attempt.
   *
   * For DB-backed aggregators (mobile money, bank):
   *   Iterates aggregators in priority order; first one that `isSupported()`
   *   for the given country + method is used.
   *
   * For direct protocol adapters (Lightning, Crypto):
   *   Falls through to the switch statement below.
   */
  getProvider(method: string, country?: string) {
    const normalized = method?.toUpperCase();

    // ── DB-backed aggregator routing (priority order) ──────────────────────────
    if (country && ['MOMO', 'ORANGE', 'BANK', 'CARD', 'MOBILE_MONEY'].includes(normalized)) {
      for (const agg of this.aggregators) {
        // isSupported is synchronous for Netwalletpay (in-memory map),
        // but async for ZikoPay (DB query). For sync calls we cast to boolean.
        // The async case is handled by the async getProviderAsync() overload below.
        const supported = agg.provider.isSupported(country, normalized);
        if (supported === true || (typeof supported !== 'object' && supported)) {
          this.logger.log(`🔄 Routing to ${agg.code} [priority ${agg.priority}]: ${country} - ${normalized}`);
          return agg.provider as any;
        }
      }
    }

    // ── Direct protocol adapters ───────────────────────────────────────────────
    switch (normalized) {
      case 'LIGHTNING':
        return this.lightning;

      case 'BTC':
      case 'CRYPTO':
      case 'USDT':
        return this.crypto;

      // Legacy fallbacks (only when no aggregator covers the country)
      case 'MOMO':
        return this.momo;
      case 'ORANGE':
        return this.orange;
      case 'BANK':
        return this.bank;

      default:
        throw new Error(`Unsupported payment method: ${method}`);
    }
  }

  /**
   * Async version — required when ZikoPay's DB-query `isSupported` must be awaited.
   * Call this in the payment use case when the country is known upfront.
   */
  async getProviderAsync(method: string, country?: string): Promise<any> {
    const normalized = method?.toUpperCase();

    if (country && ['MOMO', 'ORANGE', 'BANK', 'CARD', 'MOBILE_MONEY'].includes(normalized)) {
      for (const agg of this.aggregators) {
        let supported: boolean;
        try {
          const result = agg.provider.isSupported(country, normalized);
          supported = result instanceof Promise ? await result : result;
        } catch {
          supported = false;
        }

        if (supported) {
          this.logger.log(`🔄 [async] Routing to ${agg.code} [priority ${agg.priority}]: ${country} - ${normalized}`);
          return agg.provider;
        }
      }
    }

    // Protocol adapters don't need async
    return this.getProvider(method, country);
  }
}
