/* eslint-disable prettier/prettier */
import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { CreatePricingDto } from './dto/create-pricing.dto.js';
import { UpdatePricingDto } from './dto/update-fee-config.dto.js';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private prisma: PrismaService) {}

  // ============================
  // CREATE
  // ============================
  async create(dto: CreatePricingDto) {
    return this.prisma.feeConfig.create({
      data: {
        baseCurrencyCode: dto.baseCurrencyCode,
        targetCurrencyCode: dto.targetCurrencyCode,
        paymentMethod: dto.paymentMethod,
        payoutMethod: dto.payoutMethod, // 🔥 NEW
        flow: dto.flow,
        feePercent: dto.feePercent,
        spreadPercent: dto.spreadPercent,
        priority: dto.priority ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  // ============================
  // GET ALL
  // ============================
  async findAll() {
    return this.prisma.feeConfig.findMany({
      orderBy: { priority: 'desc' },
    });
  }

  // ============================
  // GET ONE
  // ============================
  async findOne(id: string) {
    const pricing = await this.prisma.feeConfig.findUnique({
      where: { id },
    });

    if (!pricing) {
      throw new NotFoundException('Pricing not found');
    }

    return pricing;
  }

  // ============================
  // UPDATE
  // ============================
  async update(id: string, dto: UpdatePricingDto) {
    await this.findOne(id);

    return this.prisma.feeConfig.update({
      where: { id },
      data: dto,
    });
  }

  // ============================
  // DELETE
  // ============================
  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.feeConfig.delete({
      where: { id },
    });
  }

  // ============================
  // TOGGLE ACTIVE
  // ============================
  async toggle(id: string) {
    const pricing = await this.findOne(id);

    return this.prisma.feeConfig.update({
      where: { id },
      data: {
        isActive: !pricing.isActive,
      },
    });
  }

  // ============================
  // 🔥 ADVANCED PRICING ENGINE
  // ============================
  async getPricing(params: {
    baseCurrency: string;
    targetCurrency: string;
    paymentMethod?: string;
    payoutMethod?: string; // 🔥 NEW
    flow?: string;
  }) {
    this.logger.log(`🔍 Pricing lookup`);
    console.log('📥 Pricing params:', params);

    const configs = await this.prisma.feeConfig.findMany({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
    });

    let bestMatch: any = null;
    let bestScore = -1;

    for (const config of configs) {
      let score = 0;

      // 🎯 BASE CURRENCY
      if (!config.baseCurrencyCode) score += 1;
      else if (config.baseCurrencyCode === params.baseCurrency) score += 5;
      else continue;

      // 🎯 TARGET CURRENCY
      if (!config.targetCurrencyCode) score += 1;
      else if (config.targetCurrencyCode === params.targetCurrency) score += 5;
      else continue;

      // 🎯 PAYMENT METHOD (PAYER)
      if (!config.paymentMethod) score += 1;
      else if (config.paymentMethod === params.paymentMethod) score += 4;
      else continue;

      // 🎯 PAYOUT METHOD (RECEIVER) 🔥 NEW
      if (!config.payoutMethod) score += 1;
      else if (config.payoutMethod === params.payoutMethod) score += 4;
      else continue;

      // 🎯 FLOW
      if (!config.flow) score += 1;
      else if (config.flow === params.flow) score += 3;
      else continue;

      // 🎯 PRIORITY BOOST
      score += config.priority;

      // 🏆 BEST MATCH
      if (score > bestScore) {
        bestScore = score;
        bestMatch = config;
      }
    }

    // ============================
    // 🔒 FALLBACK (VERY IMPORTANT)
    // ============================
    if (!bestMatch) {
      console.warn('⚠️ No pricing match found → using fallback');

      return {
        feePercent: 1.5,
        spreadPercent: 1.0,
      };
    }

    console.log('✅ Pricing match found:', {
      id: bestMatch.id,
      feePercent: bestMatch.feePercent,
      spreadPercent: bestMatch.spreadPercent,
      score: bestScore,
    });

    return {
      feePercent: Number(bestMatch.feePercent),
      spreadPercent: Number(bestMatch.spreadPercent),
    };
  }
}