import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminGuard } from './guards/admin.guard.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PaymentModule } from '../payment/payment.module.js';

@Module({
  imports: [PrismaModule, ConfigModule, PaymentModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
  exports: [AdminGuard, AdminService],
})
export class AdminModule {}
