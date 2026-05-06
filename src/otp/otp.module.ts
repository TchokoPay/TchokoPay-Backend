import { Module } from '@nestjs/common';
import { OtpService } from './otp.service.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [EmailModule],
  providers: [OtpService],
  exports: [OtpService],
})
export class OtpModule {}
