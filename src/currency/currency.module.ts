import { Module } from '@nestjs/common';
import { CurrencyService } from './currency.service.js';
import { CurrencyController } from './currency.controller.js';

@Module({
  controllers: [CurrencyController],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}