/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { UserSettingsService } from './services/user-settings.service.js';
import { PaymentSettingsController } from './controllers/payment-settings.controller.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController, PaymentSettingsController],
  providers: [UsersService, UserSettingsService],
  exports: [UserSettingsService],
})
export class UsersModule {}