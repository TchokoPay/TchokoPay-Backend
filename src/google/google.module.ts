/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { GoogleAuthService } from './google-auth.service.js';

@Module({
  providers: [GoogleAuthService],
  exports: [GoogleAuthService],
})
export class GoogleModule {}