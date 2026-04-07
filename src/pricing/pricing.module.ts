/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service.js';
import { PricingController } from './pricing.controller.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}