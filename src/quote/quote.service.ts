/* eslint-disable prettier/prettier */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { Prisma, Quote } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service.js';

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);
  private readonly cryptoRateCache = new Map<
    string,
    { rate: number; source: string; fetchedAt: number }
  >();

  constructor(
    private prisma: PrismaService,
    private pricingService: PricingService,
  ) {}

  // ============================
  // CREATE QUOTE
  // ============================
  async create(dto: CreateQuoteDto): Promise<Quote> {
    this.logger.log(
      `Creating quote: ${dto.baseCurrency} → ${dto.targetCurrency}`,
    );

    console.log('🚀 Quote request received:', dto);

    if (!dto.paymentMethod || !dto.payoutMethod) {
      throw new BadRequestException(
        'paymentMethod and payoutMethod are required',
      );
    }

    if (!dto.amountType) {
      throw new BadRequestException('amountType is required (PAY or RECEIVE)');
    }

    const baseCurrency = await this.prisma.currency.findUnique({
      where: { code: dto.baseCurrency.toUpperCase() },
    });

    const targetCurrency = await this.prisma.currency.findUnique({
      where: { code: dto.targetCurrency.toUpperCase() },
    });

    if (!baseCurrency || !targetCurrency) {
      throw new NotFoundException('Invalid currency');
    }

    // ============================
    // PRICING
    // ============================
    let pricing;

    if (dto.cleanRate) {
      // Merchant settlement leg: no platform fee/spread (the payer bears those).
      pricing = { feePercent: 0, spreadPercent: 0 };
    } else {
      try {
        pricing = await this.pricingService.getPricing({
          // Events/links price by the merchant's base currency (e.g. USD),
          // not the payer's FX currency.
          baseCurrency: dto.pricingBaseCurrency || baseCurrency.code,
          targetCurrency: targetCurrency.code,
          paymentMethod: dto.paymentMethod,
          payoutMethod: dto.payoutMethod,
          flow: dto.flow,
        });
      } catch (err) {
        console.log(
          `⚠️ No pricing match found for ${dto.pricingBaseCurrency || baseCurrency.code}→${targetCurrency.code} | ${dto.paymentMethod}→${dto.payoutMethod} → using fallback`,
        );
        pricing = { feePercent: 1.5, spreadPercent: 1.0 };
      }
    }

    const feePercent = Number(pricing.feePercent ?? 1.5);
    const spreadPercent = Number(pricing.spreadPercent ?? 1.0);

    // ============================
    // SAME CURRENCY CHECK
    // ============================
    const isSameCurrency = baseCurrency.code === targetCurrency.code;

    // ============================
    // EXCHANGE RATE
    // ============================
    let rate: number;
    let adjustedRate: number;

    if (isSameCurrency) {
      // Same currency → no exchange rate needed
      rate = 1.0;
      adjustedRate = 1.0;
      this.logger.log(
        `Same currency (${baseCurrency.code}): skipping exchange rate lookup`,
      );
    } else {
      // Different currencies → fetch exchange rate
      rate = await this.getSmartExchangeRate(
        baseCurrency.code,
        targetCurrency.code,
      );

      if (!rate || isNaN(rate)) {
        throw new BadRequestException('Invalid exchange rate');
      }

      adjustedRate = rate * (1 - spreadPercent / 100);
    }

    // ============================
    // 💥 CORE LOGIC (FEES ADDED TO PAYER)
    // ============================
    const inputAmount = Number(dto.amount);

    let baseAmount: number;
    let targetAmount: number;
    let feeAmount: number;

    // ============================
    // PAY MODE: Amount specified is what payer intends (BEFORE fees)
    // Receiver gets: amount * exchangeRate
    // Payer pays: amount + fees (added on top)
    // ============================
    if (dto.amountType === 'PAY') {
      const netBase = inputAmount; // What payer intends to send without fees
      feeAmount = netBase * (feePercent / 100);
      baseAmount = netBase + feeAmount; // Payer pays NET + FEE
      targetAmount = netBase * adjustedRate; // Receiver gets NET amount converted
    }

    // ============================
    // RECEIVE MODE: Amount specified is what receiver GETS (exact)
    // Receiver gets: amount (exact)
    // Payer pays: equivalent in base currency + fee (both in base currency)
    // ============================
    else if (dto.amountType === 'RECEIVE') {
      targetAmount = inputAmount; // Receiver gets exactly this

      if (isSameCurrency) {
        // Same currency — fee is a straight percentage added on top
        feeAmount = targetAmount * (feePercent / 100);
        baseAmount = targetAmount + feeAmount;
      } else {
        // Cross-currency — convert to base first, then apply fee in base currency.
        // Avoids the unit-mismatch bug of adding XAF fee to a BTC amount.
        const netBase = targetAmount / adjustedRate;
        feeAmount = netBase * (feePercent / 100);
        baseAmount = netBase + feeAmount;
      }
    }

    // ============================
    // DEFAULT (should not happen due to validation)
    // ============================
    else {
      throw new BadRequestException('Invalid amountType');
    }

    const rawBaseAmount = baseAmount;
    const rawTargetAmount = targetAmount;
    const rawFeeAmount = feeAmount;

    baseAmount = this.roundAmountForCurrency(baseAmount, baseCurrency.decimals, baseCurrency.isCrypto);
    feeAmount = this.roundAmountForCurrency(feeAmount, baseCurrency.decimals, baseCurrency.isCrypto);

    // ── Transaction limit check (both sides must pass) ────────────────────────
    // Cross-currency: if XAF→KES, both the XAF payer amount AND the KES recipient
    // amount must be within their respective configured limits.
    await this.checkTransactionLimits(baseAmount, baseCurrency.code, targetAmount, targetCurrency.code);

    // ============================
    // EXPIRY
    // ============================
    const expiresAt = new Date(Date.now() + 60 * 1000);

    // ============================
    // LOG QUOTE CALCULATION
    // ============================
    console.log('📊 QUOTE CALCULATION SUMMARY:');
    console.log(`  Currency: ${baseCurrency.code} → ${targetCurrency.code}`);
    console.log(`  Flow: ${dto.flow}`);
    console.log(`  AmountType: ${dto.amountType}`);
    console.log(`  IsSameCurrency: ${isSameCurrency}`);
    console.log(`  ExchangeRate: ${adjustedRate}`);
    console.log(`  FeePercent: ${feePercent}%`);
    console.log(`  ---`);
    console.log(
      `  Original Base Amount: ${rawBaseAmount} ${baseCurrency.code} → Rounded Up: ${baseAmount} ${baseCurrency.code}`,
    );
    console.log(
      `  Original Target Amount: ${rawTargetAmount} ${targetCurrency.code} → Preserved: ${targetAmount} ${targetCurrency.code}`,
    );
    console.log(
      `  Original Fee Amount: ${rawFeeAmount} ${baseCurrency.code} → Rounded Up: ${feeAmount} ${baseCurrency.code}`,
    );
    console.log(
      `  Payer (Base) Amount: ${baseAmount} ${baseCurrency.code} (includes fee)`,
    );
    console.log(
      `  Receiver (Target) Amount: ${targetAmount} ${targetCurrency.code} (exact, no deduction)`,
    );
    console.log(`  Fee Amount: ${feeAmount} ${baseCurrency.code}`);
    console.log(
      `  👤 PAYER CHARGES: ${baseAmount} ${baseCurrency.code} (${feeAmount} ${baseCurrency.code} fee included)`,
    );
    console.log(
      `  👥 RECEIVER GETS: ${targetAmount} ${targetCurrency.code} (fee NOT deducted)`,
    );

    // ============================
    // SAVE QUOTE
    // ============================
    const quote = await this.prisma.quote.create({
      data: {
        baseCurrencyId: baseCurrency.id,
        targetCurrencyId: targetCurrency.id,

        baseAmount: new Prisma.Decimal(baseAmount),
        targetAmount: new Prisma.Decimal(targetAmount),

        exchangeRate: new Prisma.Decimal(adjustedRate),

        fee: new Prisma.Decimal(feeAmount),

        paymentMethod: dto.paymentMethod,
        payoutMethod: dto.payoutMethod,

        flow: dto.flow ?? 'DIRECT',

        amountType: dto.amountType,

        rateSource: 'smart-engine',

        expiresAt,
        isUsed: false,
      },
      include: {
        baseCurrency: true,
        targetCurrency: true,
      },
    });

    return quote;
  }

  async preview(dto: CreateQuoteDto) {
    this.logger.log(
      `Previewing quote: ${dto.baseCurrency} â†’ ${dto.targetCurrency}`,
    );

    console.log('ðŸ” Quote preview request received:', dto);

    if (!dto.paymentMethod || !dto.payoutMethod) {
      throw new BadRequestException(
        'paymentMethod and payoutMethod are required',
      );
    }

    if (!dto.amountType) {
      throw new BadRequestException('amountType is required (PAY or RECEIVE)');
    }

    const baseCurrency = await this.prisma.currency.findUnique({
      where: { code: dto.baseCurrency.toUpperCase() },
    });

    const targetCurrency = await this.prisma.currency.findUnique({
      where: { code: dto.targetCurrency.toUpperCase() },
    });

    if (!baseCurrency || !targetCurrency) {
      throw new NotFoundException('Invalid currency');
    }

    let pricing;

    if (dto.cleanRate) {
      pricing = { feePercent: 0, spreadPercent: 0 };
    } else {
      try {
        pricing = await this.pricingService.getPricing({
          baseCurrency: dto.pricingBaseCurrency || baseCurrency.code,
          targetCurrency: targetCurrency.code,
          paymentMethod: dto.paymentMethod,
          payoutMethod: dto.payoutMethod,
          flow: dto.flow,
        });
      } catch (err) {
      console.log(
        `âš ï¸ No pricing match found for ${baseCurrency.code}â†’${targetCurrency.code} | ${dto.paymentMethod}â†’${dto.payoutMethod} â†’ using fallback`,
      );
        pricing = { feePercent: 1.5, spreadPercent: 1.0 };
      }
    }

    const feePercent = Number(pricing.feePercent ?? 1.5);
    const spreadPercent = Number(pricing.spreadPercent ?? 1.0);
    const isSameCurrency = baseCurrency.code === targetCurrency.code;

    let rate: number;
    let adjustedRate: number;

    if (isSameCurrency) {
      rate = 1.0;
      adjustedRate = 1.0;
    } else {
      rate = await this.getSmartExchangeRate(
        baseCurrency.code,
        targetCurrency.code,
      );

      if (!rate || isNaN(rate)) {
        throw new BadRequestException('Invalid exchange rate');
      }

      adjustedRate = rate * (1 - spreadPercent / 100);
    }

    const inputAmount = Number(dto.amount);

    let baseAmount: number;
    let targetAmount: number;
    let feeAmount: number;

    if (dto.amountType === 'PAY') {
      const netBase = inputAmount;
      feeAmount = netBase * (feePercent / 100);
      baseAmount = netBase + feeAmount;
      targetAmount = netBase * adjustedRate;
    } else if (dto.amountType === 'RECEIVE') {
      targetAmount = inputAmount;

      if (isSameCurrency) {
        feeAmount = targetAmount * (feePercent / 100);
        baseAmount = targetAmount + feeAmount;
      } else {
        const netBase = targetAmount / adjustedRate;
        feeAmount = netBase * (feePercent / 100);
        baseAmount = netBase + feeAmount;
      }
    } else {
      throw new BadRequestException('Invalid amountType');
    }

    const rawBaseAmount = baseAmount;
    const rawTargetAmount = targetAmount;
    const rawFeeAmount = feeAmount;

    baseAmount = this.roundAmountForCurrency(baseAmount, baseCurrency.decimals, baseCurrency.isCrypto);
    feeAmount = this.roundAmountForCurrency(feeAmount, baseCurrency.decimals, baseCurrency.isCrypto);

    // Same cross-currency limit check as the full quote — preview should reject
    // early so the user sees the error before confirming payment.
    await this.checkTransactionLimits(baseAmount, baseCurrency.code, targetAmount, targetCurrency.code);

    console.log('🔍 QUOTE PREVIEW SUMMARY:');
    console.log(`  Currency: ${baseCurrency.code} → ${targetCurrency.code}`);
    console.log(`  Flow: ${dto.flow}`);
    console.log(`  AmountType: ${dto.amountType}`);
    console.log(`  ExchangeRate: ${adjustedRate}`);
    console.log(`  FeePercent: ${feePercent}%`);
    console.log(
      `  Original Base Amount: ${rawBaseAmount} ${baseCurrency.code} → Rounded Up: ${baseAmount} ${baseCurrency.code}`,
    );
    console.log(
      `  Original Target Amount: ${rawTargetAmount} ${targetCurrency.code} → Preserved: ${targetAmount} ${targetCurrency.code}`,
    );
    console.log(
      `  Original Fee Amount: ${rawFeeAmount} ${baseCurrency.code} → Rounded Up: ${feeAmount} ${baseCurrency.code}`,
    );

    return {
      baseAmount,
      targetAmount,
      exchangeRate: adjustedRate,
      fee: feeAmount,
      feePercent,
      spreadPercent,
      amountType: dto.amountType,
      paymentMethod: dto.paymentMethod,
      payoutMethod: dto.payoutMethod,
      flow: dto.flow ?? 'DIRECT',
      baseCurrency: {
        code: baseCurrency.code,
        symbol: baseCurrency.symbol,
      },
      targetCurrency: {
        code: targetCurrency.code,
        symbol: targetCurrency.symbol,
      },
      expiresAt: new Date(Date.now() + 60 * 1000),
    };
  }

  // ============================
  // GET QUOTE
  // ============================
  async getQuote(id: string): Promise<Quote> {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: {
        baseCurrency: true,
        targetCurrency: true,
      },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (new Date() > quote.expiresAt) {
      throw new BadRequestException('Quote expired');
    }

    if (quote.isUsed) {
      throw new BadRequestException('Quote already used');
    }

    return quote;
  }

  // ============================
  // MARK QUOTE AS USED
  // ============================
  async markAsUsed(id: string): Promise<Quote> {
    return this.prisma.quote.update({
      where: { id },
      data: { isUsed: true },
    });
  }

  // ============================
  // SMART EXCHANGE ENGINE
  // ============================
  private async getSmartExchangeRate(base: string, target: string) {
    const isBaseCrypto = this.isCrypto(base);
    const isTargetCrypto = this.isCrypto(target);

    if (isBaseCrypto && !isTargetCrypto) {
      const usd = await this.getCryptoToUSD(base);

      if (target === 'USD') return usd;

      const fiat = await this.getFiatRate('USD', target);

      return usd * fiat;
    }

    if (!isBaseCrypto && isTargetCrypto) {
      const fiatToUsd = await this.getFiatRate(base, 'USD');
      const cryptoUsd = await this.getCryptoToUSD(target);

      return fiatToUsd / cryptoUsd;
    }

    if (isBaseCrypto && isTargetCrypto) {
      const baseUsd = await this.getCryptoToUSD(base);
      const targetUsd = await this.getCryptoToUSD(target);

      return baseUsd / targetUsd;
    }

    return this.getFiatRate(base, target);
  }

  private async getCryptoToUSD(base: string) {
    const map: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      SAT: 'bitcoin', // SAT is denominated in satoshis (100M sats = 1 BTC)
    };

    const coinId = map[base];

    if (!coinId) throw new BadRequestException('Unsupported crypto');

    const normalizedBase = base.toUpperCase();
    const providers = [
      () => this.fetchCoinGeckoUsdRate(coinId),
      () => this.fetchCoinbaseUsdRate(normalizedBase === 'SAT' ? 'BTC' : normalizedBase),
    ];
    const failures: string[] = [];
    let rate: number | null = null;
    let source = '';

    for (const provider of providers) {
      try {
        const result = await provider();
        if (result.rate > 0 && Number.isFinite(result.rate)) {
          rate = result.rate;
          source = result.source;
          break;
        }
      } catch (error) {
        failures.push((error as Error).message);
      }
    }

    if (!rate) {
      const cachedRate = this.getCachedCryptoRate(normalizedBase);
      if (cachedRate) {
        this.logger.warn(
          `Using cached ${normalizedBase}/USD rate from ${cachedRate.source} after provider failure: ${failures.join(' | ')}`,
        );
        rate = cachedRate.rate;
        source = `${cachedRate.source}-cache`;
      }
    }

    if (!rate) {
      this.logger.error(
        `Crypto rate lookup failed for ${normalizedBase}: ${failures.join(' | ') || 'no provider returned a rate'}`,
      );
      throw new BadRequestException(
        'Crypto rate unavailable right now. Please try again in a moment.',
      );
    }

    // SAT is 1/100,000,000 of BTC, so adjust the rate accordingly
    if (normalizedBase === 'SAT') {
      rate = rate / 100_000_000;
    }

    this.cacheCryptoRate(normalizedBase, rate, source);
    return rate;
  }

  private async fetchCoinGeckoUsdRate(coinId: string): Promise<{
    rate: number;
    source: string;
  }> {
    const url = `${process.env.COINGECKO_BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`CoinGecko responded with HTTP ${res.status}`);
    }

    const data = await res.json();
    const rate = Number(data?.[coinId]?.usd);

    if (!rate || !Number.isFinite(rate)) {
      throw new Error('CoinGecko returned no USD rate');
    }

    return { rate, source: 'coingecko' };
  }

  private async fetchCoinbaseUsdRate(symbol: string): Promise<{
    rate: number;
    source: string;
  }> {
    if (!['BTC', 'ETH'].includes(symbol)) {
      throw new Error(`Coinbase fallback unavailable for ${symbol}`);
    }

    const url = `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Coinbase responded with HTTP ${res.status}`);
    }

    const data = await res.json();
    const rate = Number(data?.data?.amount);

    if (!rate || !Number.isFinite(rate)) {
      throw new Error('Coinbase returned no USD rate');
    }

    return { rate, source: 'coinbase' };
  }

  private cacheCryptoRate(symbol: string, rate: number, source: string) {
    this.cryptoRateCache.set(symbol, {
      rate,
      source,
      fetchedAt: Date.now(),
    });
  }

  private getCachedCryptoRate(symbol: string) {
    const cachedRate = this.cryptoRateCache.get(symbol);

    if (!cachedRate) {
      return null;
    }

    const maxAgeMs = 15 * 60 * 1000;
    if (Date.now() - cachedRate.fetchedAt > maxAgeMs) {
      this.cryptoRateCache.delete(symbol);
      return null;
    }

    return cachedRate;
  }

  private async getFiatRate(base: string, target: string) {
    const url = `${process.env.EXCHANGE_RATE_BASE_URL}/${process.env.EXCHANGE_RATE_API_KEY}/latest/${base}`;

    const res = await fetch(url);
    const data = await res.json();

    const rate = data?.conversion_rates?.[target];

    if (!rate) {
      throw new BadRequestException(
        `Rate not found for ${base} → ${target}`,
      );
    }

    return rate;
  }

  private isCrypto(currency: string) {
    return ['BTC', 'ETH', 'SAT'].includes(currency);
  }

  private roundAmountForCurrency(
    amount: number,
    decimals: number,
    isCrypto: boolean,
  ) {
    if (isCrypto) {
      return amount;
    }

    const factor = 10 ** decimals;
    return Math.ceil((amount - Number.EPSILON) * factor) / factor;
  }

  /**
   * Enforce active transaction limits for both the payer's currency (base) and
   * the recipient's currency (target).
   *
   * Cross-currency rule: XAF → KES requires BOTH the XAF amount ≥ XAF min AND
   * the KES amount ≥ KES min. Even if the KES side is above its floor, a tiny
   * XAF amount (e.g. 50 XAF) is still rejected because it's below the XAF floor.
   */
  private async checkTransactionLimits(
    baseAmount: number,
    baseCurrencyCode: string,
    targetAmount: number,
    targetCurrencyCode: string,
  ): Promise<void> {
    const [baseLimit, targetLimit] = await Promise.all([
      this.prisma.transactionLimit.findFirst({
        where: { currencyCode: baseCurrencyCode, isActive: true },
      }),
      this.prisma.transactionLimit.findFirst({
        where: { currencyCode: targetCurrencyCode, isActive: true },
      }),
    ]);

    if (baseLimit) {
      const min = Number(baseLimit.minAmount);
      const max = Number(baseLimit.maxAmount);
      if (baseAmount < min) {
        throw new BadRequestException(
          `Minimum payment is ${min.toLocaleString()} ${baseCurrencyCode}`,
        );
      }
      if (baseAmount > max) {
        throw new BadRequestException(
          `Maximum payment is ${max.toLocaleString()} ${baseCurrencyCode}`,
        );
      }
    }

    if (targetLimit) {
      const min = Number(targetLimit.minAmount);
      const max = Number(targetLimit.maxAmount);
      if (targetAmount < min) {
        throw new BadRequestException(
          `Minimum receive amount is ${min.toLocaleString()} ${targetCurrencyCode}`,
        );
      }
      if (targetAmount > max) {
        throw new BadRequestException(
          `Maximum receive amount is ${max.toLocaleString()} ${targetCurrencyCode}`,
        );
      }
    }
  }
}
