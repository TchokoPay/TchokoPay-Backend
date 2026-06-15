import { Module } from '@nestjs/common';
import { MerchantController } from './merchant.controller.js';
import { MerchantService } from './merchant.service.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [MerchantController],
  providers: [MerchantService],
  exports: [MerchantService],
})
export class MerchantModule {}
