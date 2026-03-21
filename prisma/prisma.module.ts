import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global() // makes it available everywhere
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
