import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ProcessPaymentUseCase } from '../use-cases/process-payment.usecase.js';

@Injectable()
export class QrFlow {
  constructor(
    private prisma: PrismaService,
    private processPayment: ProcessPaymentUseCase,
  ) {}

  async execute(userId: string, dto: any) {
    if (!dto.recipientHandle) {
      throw new BadRequestException('Handle required');
    }

    const identity = await this.prisma.paymentIdentity.findUnique({
      where: { handle: dto.recipientHandle },
      include: { user: true },
    });

    if (!identity) {
      throw new BadRequestException('Invalid handle');
    }

    return this.processPayment.execute({
      userId,
      dto,
    });
  }
}