import { Injectable, INestApplication, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends (PrismaClient as any) implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DIRECT_URL;
    const adapter = new PrismaPg({ connectionString });

    super({ adapter, log: ['warn', 'error'] });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  enableShutdownHooks(app: INestApplication) {
    app.enableShutdownHooks();
  }
}