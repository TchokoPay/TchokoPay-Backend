import { Module } from '@nestjs/common';

import { ContactsService } from './contacts.service.js';
import { ContactsController } from './contacts.controller.js';
import { OtpModule } from '../otp/otp.module.js';
import { EmailModule } from '../email/email.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Module({
  imports: [OtpModule, EmailModule],
  controllers: [ContactsController],
  providers: [ContactsService, PrismaService],
})
export class ContactsModule {}
