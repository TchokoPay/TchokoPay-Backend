import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateCurrencyDto } from './dto/create-currency.dto.js';
import { UpdateCurrencyDto } from './dto/update-currency.dto.js';

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);

  constructor(private prisma: PrismaService) {}

  // ================================
  // CREATE CURRENCY
  // ================================
  async create(dto: CreateCurrencyDto) {
    this.logger.log(`Creating currency: ${dto.code}`);

    const existing = await this.prisma.currency.findUnique({
      where: { code: dto.code.toUpperCase() },
    });

    if (existing) {
      this.logger.warn(`Currency already exists: ${dto.code}`);
      throw new BadRequestException('Currency already exists');
    }

    const currency = await this.prisma.currency.create({
      data: {
        code: dto.code.toUpperCase(),
        name: dto.name,
        symbol: dto.symbol,
        decimals: dto.decimals,
        isCrypto: dto.isCrypto ?? false,
      },
    });

    this.logger.log(`Currency created: ${currency.code}`);

    return currency;
  }

  // ================================
  // GET ALL CURRENCIES
  // ================================
  async findAll() {
    this.logger.log('Fetching all currencies');

    return this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ================================
  // GET ONE CURRENCY
  // ================================
  async findOne(code: string) {
    this.logger.log(`Fetching currency: ${code}`);

    const currency = await this.prisma.currency.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!currency) {
      this.logger.error(`Currency not found: ${code}`);
      throw new NotFoundException('Currency not found');
    }

    return currency;
  }

  // ================================
  // UPDATE CURRENCY
  // ================================
  async update(id: string, dto: UpdateCurrencyDto) {
    this.logger.log(`Updating currency ID: ${id}`);

    const currency = await this.prisma.currency.findUnique({
      where: { id },
    });

    if (!currency) {
      throw new NotFoundException('Currency not found');
    }

    return this.prisma.currency.update({
      where: { id },
      data: dto,
    });
  }

  // ================================
  // DEACTIVATE (SOFT DELETE)
  // ================================
  async deactivate(id: string) {
    this.logger.log(`Deactivating currency ID: ${id}`);

    return this.prisma.currency.update({
      where: { id },
      data: { isActive: false },
    });
  }
}