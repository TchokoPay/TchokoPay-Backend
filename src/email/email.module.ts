import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service.js';
import { TransactionEmailListener } from './transaction-email.listener.js';

@Module({
  imports: [ConfigModule],
  providers: [EmailService, TransactionEmailListener],
  exports: [EmailService],
})
export class EmailModule {}
