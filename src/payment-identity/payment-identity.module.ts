/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { PaymentIdentityService } from './payment-identity.service.js';
import { PaymentIdentityController } from './payment-identity.controller.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [PaymentIdentityController],
  providers: [PaymentIdentityService],
  exports: [PaymentIdentityService],
})
export class PaymentIdentityModule {}
