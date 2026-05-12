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

  /** Returns all active countries with their active Netwalletpay providers — used by the frontend payment wizard. */
  async getActiveCountries() {
    const countries = await this.prisma.country.findMany({
      where: { isActive: true },
      include: {
        currency: { select: { code: true, symbol: true } },
        providers: {
          where: { isActive: true, aggregator: { code: 'netwalletpay', isActive: true } },
          include: { method: { select: { code: true } } },
          orderBy: { providerCode: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return countries.map(c => ({
      iso2:      c.iso2,
      name:      c.name,
      dialCode:  c.dialCode,
      currency:  c.currency.code,
      providers: c.providers.map(p => ({
        code:     p.providerCode,
        name:     p.name,
        method:   p.method.code,
        requiresType: p.requiresType,
      })),
    }));
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