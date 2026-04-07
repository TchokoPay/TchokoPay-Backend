import { Module } from '@nestjs/common';
import { QuoteService } from './quote.service.js';
import { QuoteController } from './quote.controller.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PricingModule } from '../pricing/pricing.module.js';

@Module({
  imports: [PrismaModule, PricingModule],
  controllers: [QuoteController],
  providers: [QuoteService],
  exports: [QuoteService], // 🔥 IMPORTANT (used by invoice service later)
})
export class QuoteModule {}