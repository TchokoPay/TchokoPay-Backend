import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FlowType, PaymentAction } from '../enums/payment.enums.js';
import { Prisma } from '@prisma/client';

const REQUEST_EXPIRY_DAYS = 7;
const REQUEST_EXPIRY_MS = REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

@Injectable()
export class CreateRequestUseCase {
  constructor(
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

    // The requester-entered settlement detail is the source of truth for now.
    // Do not silently swap in saved payout contacts for authenticated users.
    const requestedReceivePhone =
      typeof dto.recipientPhone === 'string' && dto.recipientPhone.trim()
        ? dto.recipientPhone.trim()
        : typeof dto.payerPhone === 'string' && dto.payerPhone.trim()
          ? dto.payerPhone.trim()
          : null;
    const payoutMethod = String(dto.payoutMethod).trim().toUpperCase();

    if (['MOMO', 'ORANGE', 'BANK'].includes(payoutMethod) && !requestedReceivePhone) {
      throw new BadRequestException(
        'A receive phone or account number is required for this payment request',
      );
    }

    // For REQUEST CREATE, we don't know baseCurrency yet - payer will choose payment method later
    // Create invoice with target details only, quote will be created when someone pays

    const requester = userId?.trim()
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : null;

    const requesterPhone: string | null = requestedReceivePhone;
    const requesterName: string = requester
      ? `${requester.firstName} ${requester.lastName}`.trim() || 'TchokoPay User'
      : 'Guest User';
    const country = dto.country?.trim().toUpperCase() || 'CM';
    const payoutProviderCode: string | null =
      typeof dto.payoutProviderCode === 'string' && dto.payoutProviderCode.trim()
        ? dto.payoutProviderCode.trim()
        : null;

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

    const expiresAt = new Date(Date.now() + REQUEST_EXPIRY_MS);

    const invoice = await this.prisma.paymentInvoice.create({
      data: {
        reference: `REQ-${Date.now()}`,
        amount: new Prisma.Decimal(targetAmount),
        currency: { connect: { id: targetCurrency.id } },
        // No quote yet - will be created when paid
        description: dto.description || 'Payment request',
        country,
        paymentMethod: null, // Will be set when paid
        payoutMethod,
        payoutProviderCode,
        flow: FlowType.REQUEST,
        recipient: requester ? { connect: { id: requester.id } } : undefined,
        recipientPhone: requesterPhone,
        recipientName: requesterName,
        expiresAt,
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
              country,
              payoutMethod,
              payoutProviderCode,
              recipientPhone: requesterPhone,
              expiresInDays: REQUEST_EXPIRY_DAYS,
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
