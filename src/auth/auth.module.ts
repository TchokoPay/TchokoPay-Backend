import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { GoogleModule } from '../google/google.module.js';

@Module({
  imports: [JwtModule.register({}), GoogleModule],
  providers: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
