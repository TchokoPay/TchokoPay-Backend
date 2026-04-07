import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CloudinaryService } from '../config/cloudinary.service.js';

@Module({
  controllers: [KycController],
  providers: [KycService, PrismaService, CloudinaryService],
  exports: [KycService],
})
export class KycModule {}