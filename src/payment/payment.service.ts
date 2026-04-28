import { Injectable, NotFoundException } from '@nestjs/common';
import { FlowHelper } from './flows/flow.helper.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { NetwalletpayProvider } from './providers/netwalletpay.provider.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class PaymentService {
  constructor(
    private flowHelper: FlowHelper,
    private netwalletpayProvider: NetwalletpayProvider,
    private prisma: PrismaService,
  ) {}

  async processPayment(userId: string, dto: CreatePaymentDto) {
    return this.flowHelper.execute(userId, dto);
  }

  async verifyProviders(paymentType: string, method: string, country: string) {
    return this.netwalletpayProvider.verifyProviderConfig(
      paymentType as 'COLLECTION' | 'PAYOUT',
      method,
      country,
    );
  }

  async getInvoiceByReference(reference: string) {
    const invoice = await this.prisma.paymentInvoice.findUnique({
      where: { reference },
      include: {
        currency: true,
        recipient: {
          select: { id: true, firstName: true, lastName: true, paymentIdentity: true },
        },
        paymentLink: true,
        quote: {
          include: { baseCurrency: true, targetCurrency: true },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }
}