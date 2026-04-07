import { Injectable, BadRequestException } from '@nestjs/common';
import { DirectFlow } from './direct.flow.js';
import { QrFlow } from './qr.flow.js';
import { RequestFlow } from './request.flow.js';
import { CreatePaymentDto } from '../dto/create-payment.dto.js';

@Injectable()
export class FlowHelper {
  constructor(
    private directFlow: DirectFlow,
    private qrFlow: QrFlow,
    private requestFlow: RequestFlow,
  ) {}

  async execute(userId: string, dto: CreatePaymentDto) {
    switch (dto.flow) {
      case 'DIRECT':
        return this.directFlow.execute(userId, dto);

      case 'QR':
        return this.qrFlow.execute(userId, dto);

      case 'REQUEST':
        return this.requestFlow.execute(userId, dto);

      default:
        throw new BadRequestException('Invalid flow');
    }
  }
}