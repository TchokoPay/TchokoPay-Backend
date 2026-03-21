import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { GoogleModule } from './google/google.module.js';

@Module({
  imports: [PrismaModule, AuthModule, GoogleModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
