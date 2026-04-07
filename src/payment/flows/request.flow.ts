import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateRequestUseCase } from '../use-cases/create-request.usecase.js';
import { PayRequestUseCase } from '../use-cases/pay-request.usecase.js';

@Injectable()
export class RequestFlow {
  constructor(
    private createRequest: CreateRequestUseCase,
    private payRequest: PayRequestUseCase,
  ) {}

  async execute(userId: string, dto: any) {
    if (dto.action === 'CREATE') {
      return this.createRequest.execute(userId, dto);
    }

    if (dto.action === 'PAY') {
      return this.payRequest.execute(userId, dto);
    }

    throw new BadRequestException('Invalid request action');
  }
}