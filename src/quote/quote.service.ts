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

    try {
      pricing = await this.pricingService.getPricing({
        baseCurrency: baseCurrency.code,
        targetCurrency: targetCurrency.code,
        paymentMethod: dto.paymentMethod,
        payoutMethod: dto.payoutMethod,
        flow: dto.flow,
      });
    } catch (err) {
      console.log(
        `⚠️ No pricing match found for ${baseCurrency.code}→${targetCurrency.code} | ${dto.paymentMethod}→${dto.payoutMethod} → using fallback`,
      );
      pricing = { feePercent: 1.5, spreadPercent: 1.0 };
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
    // Receiver gets: amount (exact, no fees deducted)
    // Payer pays: more to cover receiver's amount + fees
    // ============================
    else if (dto.amountType === 'RECEIVE') {
      targetAmount = inputAmount; // Receiver gets exact amount (no deduction)
      feeAmount = targetAmount * (feePercent / 100); // Calculate fee on receiver amount
      const netBase = targetAmount / adjustedRate; // Convert receiver amount back to payer currency
      baseAmount = netBase + feeAmount; // Payer pays: NET + FEE
    }

    // ============================
    // DEFAULT (should not happen due to validation)
    // ============================
    else {
      throw new BadRequestException('Invalid amountType');
    }

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
      SAT: 'bitcoin',  // SAT is denominated in satoshis (100M sats = 1 BTC)
    };

    const coinId = map[base];

    if (!coinId) throw new BadRequestException('Unsupported crypto');

    const url = `${process.env.COINGECKO_BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd`;

    const res = await fetch(url);
    const data = await res.json();

    let rate = data?.[coinId]?.usd;

    if (!rate) throw new BadRequestException('Crypto rate failed');

    // SAT is 1/100,000,000 of BTC, so adjust the rate accordingly
    if (base === 'SAT') {
      rate = rate / 100_000_000;
    }

    return rate;
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
}