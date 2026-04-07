import { Injectable, BadRequestException } from '@nestjs/common';
import { ProcessPaymentUseCase } from '../use-cases/process-payment.usecase.js';
import { FlowType } from '../enums/payment.enums.js';

@Injectable()
export class DirectFlow {
  constructor(private processPayment: ProcessPaymentUseCase) {}

  async execute(userId: string, dto: any) {
    // ✅ Ensure correct flow
    if (dto.flow !== FlowType.DIRECT) {
      throw new BadRequestException('Invalid flow for DirectFlow');
    }

    // ✅ DIRECT requires phone
    if (!dto.recipientPhone) {
      throw new BadRequestException(
        'recipientPhone is required for DIRECT flow',
      );
    }

    return this.processPayment.execute({
      userId,
      dto,
    });
  }
}