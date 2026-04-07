import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentProvider } from './base/payment-provider.interface.js';
import { PayinDto, PayoutDto } from './base/types.js';
import { BlinkApiService } from './services/blink-api.service.js';

/**
 * Lightning Provider
 * Handles Lightning Network payments using Blink API
 * 
 * PAYIN: Creates invoice for customers to pay
 * PAYOUT: Pays Lightning invoice to recipient
 * 
 * Supports:
 * - Lightning Network (instant, low fees)
 * - BTC on-chain (slower, variable fees)
 */
@Injectable()
export class LightningProvider implements PaymentProvider {
  constructor(private blinkApi: BlinkApiService) {}

  /**
   * PAYIN: Create Lightning invoice to receive payment from customer
   * 
   * When customer wants to pay via Lightning:
   * 1. We create an invoice
   * 2. Customer scans QR or uses payment request string
   * 3. Payment is received instantly
   * 4. Invoice status changes to PAID
   * 
   * Currency mapping:
   * - BTC: satoshis (smallest unit, 0.00000001 BTC)
   * - SAT: satoshis (same as BTC)
   * 
   * @param data Payment input: amount (in satoshis or BTC), currency, reference
   * @returns Invoice response with paymentRequest (QR code string)
   */
  async payin(data: PayinDto): Promise<{
    status: string;
    invoiceId: string;
    paymentRequest: string;
    amount: number;
    currency: string;
    expiresAt: Date;
    reference: string;
  }> {
    console.log('⚡ Lightning PAYIN (Create Invoice):', data);

    try {
      // Convert amount based on currency
      const amountSat = this.convertToSatoshis(data.amount, data.currency);

      if (amountSat <= 0) {
        throw new BadRequestException('Amount must be greater than 0');
      }

      // Create invoice with Blink API
      const invoice = await this.blinkApi.createInvoice(
        amountSat,
        `TchokoPay Payment - ${data.currency}`,
        data.reference,
      );

      return {
        status: 'INVOICE_CREATED',
        invoiceId: invoice.id,
        paymentRequest: invoice.paymentRequest,
        amount: invoice.amount,
        currency: data.currency,
        expiresAt: invoice.expiresAt,
        reference: data.reference,
      };
    } catch (error) {
      console.error('❌ Lightning PAYIN failed:', error);
      throw error;
    }
  }

  /**
   * PAYOUT: Pay Lightning invoice to recipient
   * 
   * When we need to send Lightning payment to recipient:
   * 1. We receive the payment request from invoice
   * 2. We pay it from our Blink account
   * 3. Recipient receives funds instantly
   * 
   * Currency mapping:
   * - BTC: satoshis (smallest unit)
   * - SAT: satoshis
   * 
   * @param data Payment output: amount (in satoshis), currency, reference (invoice/payment request)
   * @returns Payment confirmation with transaction details
   */
  async payout(data: PayoutDto): Promise<{
    status: string;
    amount: number;
    currency: string;
    fee: number;
    reference: string;
    timestamp: Date;
  }> {
    console.log('⚡ Lightning PAYOUT (Pay Invoice):', data);

    try {
      const amountSat = this.convertToSatoshis(data.amount, data.currency);

      if (amountSat <= 0) {
        throw new BadRequestException('Amount must be greater than 0');
      }

      // Check account balance before paying
      const balance = await this.blinkApi.getAccountBalance();
      if (balance.btc < amountSat) {
        throw new BadRequestException(
          `Insufficient balance. Required: ${amountSat} sat, Available: ${balance.btc} sat`,
        );
      }

      // reference is the payment request string from the invoice
      const paymentRequest = data.reference;

      // Pay the invoice
      const payment = await this.blinkApi.payLightningInvoice(
        paymentRequest,
        `TchokoPay Payout - ${data.reference}`,
      );

      return {
        status: 'SUCCESS',
        amount: amountSat,
        currency: data.currency,
        fee: payment.fee,
        reference: data.reference,
        timestamp: payment.timestamp,
      };
    } catch (error) {
      console.error('❌ Lightning PAYOUT failed:', error);
      throw error;
    }
  }

  /**
   * Convert currency amounts to satoshis for Blink API
   * Blink API accepts all amounts in satoshis internally
   * 
   * Conversion:
   * - 1 BTC = 100,000,000 SAT
   * - SAT = satoshis (no conversion)
   * 
   * Supports both BTC and SAT dynamically:
   * - If amount < 1 and currency contains 'BTC' or is unrecognized small decimal: multiply by 100M
   * - If amount >= 1: treat as satoshis
   * - If currency is 'SAT': treat as satoshis
   * 
   * @param amount Amount in the specified currency
   * @param currency Currency code (BTC, SAT, etc.) or any identifier
   * @returns Amount in satoshis
   */
  private convertToSatoshis(amount: number, currency: string): number {
    const upperCurrency = currency ? currency.toUpperCase() : '';

    // Explicit SAT handling
    if (upperCurrency.includes('SAT')) {
      return Math.floor(amount);
    }

    // Explicit BTC handling
    if (upperCurrency.includes('BTC')) {
      return Math.floor(amount * 100000000);
    }

    // Smart detection: if amount is a small decimal (< 1), treat as BTC and convert
    // This handles cases where currency is passed as UUID or unrecognized format
    if (amount > 0 && amount < 1) {
      // Small amount < 1 = likely BTC, convert to satoshis
      const satoshis = Math.floor(amount * 100000000);
      if (satoshis >= 1) {
        return satoshis;
      }
    }

    // If amount is >= 1, treat as satoshis already
    if (amount >= 1) {
      return Math.floor(amount);
    }

    // Fallback: very small amounts treated as BTC
    return Math.floor(amount * 100000000);
  }
}
