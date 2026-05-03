import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { QuoteService } from '../../quote/quote.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FlowType, PaymentAction } from '../enums/payment.enums.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class CreateRequestUseCase {
  constructor(
    private quoteService: QuoteService,
    private prisma: PrismaService,
  ) {}

  async execute(userId: string, dto: any) {
    if (dto.flow !== FlowType.REQUEST) {
      throw new BadRequestException('flow must be REQUEST for request creation');
    }

    if (dto.action !== PaymentAction.CREATE) {
      throw new BadRequestException('action must be CREATE for request creation');
    }

    // Validate required fields for CREATE - NO baseCurrency needed!
    if (!dto.amountType || !dto.amount || !dto.targetCurrency || !dto.payoutMethod) {
      throw new BadRequestException('amountType, amount, targetCurrency, and payoutMethod are required for request creation');
    }

    // For REQUEST CREATE (MOMO payout only for now):
    // - Registered user: auto-use verified phone, no payerPhone needed
    // - Guest user: MUST provide payerPhone (their MOMO number for receiving)
    const requestedReceivePhone = dto.recipientPhone || dto.payerPhone;

    if (dto.payoutMethod?.toUpperCase() === 'MOMO') {
      // MOMO payout - check if registered user or guest
      const isRegistered = userId && userId.trim().length > 0;
      
      if (!isRegistered && !requestedReceivePhone) {
        throw new BadRequestException(
          'For MOMO payout as guest user, a receive phone number is required',
        );
      }
    }

    // For REQUEST CREATE, we don't know baseCurrency yet - payer will choose payment method later
    // Create invoice with target details only, quote will be created when someone pays

    const requester = await this.prisma.user.findUnique({ where: { id: userId } });

    let requesterPhone: string | null = null;
    let requesterName: string = 'Guest User';

    if (requester) {
      // Registered user - auto-fetch verified phone
      const contact = await this.prisma.userContact.findFirst({
        where: { userId, type: 'PHONE', isVerified: true },
      });

      if (!contact) {
        throw new BadRequestException('Registered user must have a verified phone contact');
      }

      requesterPhone = contact.value;
      requesterName = `${requester.firstName} ${requester.lastName}`;
    } else {
      // Guest user - use provided receive phone
      if (!requestedReceivePhone) {
        throw new BadRequestException('Guest users must provide a mobile money number to receive funds');
      }
      requesterPhone = requestedReceivePhone;
      requesterName = 'Guest User';
    }

    // Get target currency for invoice
    const targetCurrency = await this.prisma.currency.findUnique({
      where: { code: dto.targetCurrency.toUpperCase() },
    });

    if (!targetCurrency) {
      throw new NotFoundException('Invalid target currency');
    }

    // Calculate target amount based on amountType
    let targetAmount: number;
    if (dto.amountType === 'PAY') {
      targetAmount = dto.amount; // Requester wants to receive this amount
    } else {
      // RECEIVE mode - this would be the amount the requester receives
      targetAmount = dto.amount;
    }

    const invoice = await this.prisma.paymentInvoice.create({
      data: {
        reference: `REQ-${Date.now()}`,
        amount: new Prisma.Decimal(targetAmount),
        currency: { connect: { id: targetCurrency.id } },
        // No quote yet - will be created when paid
        description: dto.description || 'Payment request',
        country: dto.country?.trim().toUpperCase() || 'CM',
        paymentMethod: null, // Will be set when paid
        payoutMethod: dto.payoutMethod,
        flow: FlowType.REQUEST,
        recipient: requester ? { connect: { id: requester.id } } : undefined,
        recipientPhone: requesterPhone,
        recipientName: requesterName,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    const paymentRequest = requester
      ? await this.prisma.paymentRequest.create({
          data: {
            user: { connect: { id: requester.id } },
            amount: new Prisma.Decimal(targetAmount),
            currency: targetCurrency.code,
            status: 'PENDING',
            paymentLink: `REQUEST://${invoice.id}`,
            expiresAt: invoice.expiresAt,
            metadata: {
              amountType: dto.amountType,
              payoutMethod: dto.payoutMethod,
              invoiceId: invoice.id,
              action: PaymentAction.CREATE,
            },
          },
        })
      : null;

    return {
      message: 'Payment request created',
      invoice,
      paymentRequest,
      // No quote yet - will be created when paid
    };
  }
}
