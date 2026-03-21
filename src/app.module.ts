import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { GoogleModule } from './google/google.module.js';
import { UsersModule } from './users/users.module.js';
import { ContactsModule } from './contacts/contacts.module.js';
import { OtpModule } from './otp/otp.module.js';

@Module({
  imports: [PrismaModule, AuthModule, GoogleModule, UsersModule, ContactsModule, OtpModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
