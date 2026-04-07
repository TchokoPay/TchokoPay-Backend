import { Injectable } from '@nestjs/common';
import { FlowHelper } from '../flows/flow.helper.js';
import { CreatePaymentDto } from '../dto/create-payment.dto.js';

@Injectable()
export class PayoutService {
  constructor(private flowHelper: FlowHelper) {}

  async processPayment(userId: string, dto: CreatePaymentDto) {
    return this.flowHelper.execute(userId, dto);
  }
}