import { Injectable } from '@nestjs/common';
import { PaymentProvider } from './base/payment-provider.interface.js';
import { PayinDto, PayoutDto } from './base/types.js';
import { BlinkApiService } from './services/blink-api.service.js';

/**
 * Crypto Provider
 * Handles on-chain Bitcoin and other cryptocurrency payments
 * Uses Blink API for on-chain BTC transactions
 * 
 * Supports:
 * - On-chain Bitcoin (slower, confirmed by blockchain)
 * - USDT/Stablecoins (if Blink supports)
 * 
 * Note: Currently routes through Blink API
 * Can be extended to support multiple crypto providers
 */
@Injectable()
export class CryptoProvider implements PaymentProvider {
  constructor(private blinkApi: BlinkApiService) {}

  /**
   * PAYIN: Request BTC on-chain payment from customer
   * 
   * When customer wants to pay via on-chain Bitcoin:
   * 1. Generate BTC address for customer
   * 2. Customer sends funds to this address
   * 3. Payment is confirmed when enough blocks are mined (typically 1-10 minutes)
   * 4. Funds are credited to account
   * 
   * @param data Payment input: amount (in satoshis/BTC), currency, reference
   * @returns Object with BTC address to receive payment
   */
  async payin(data: PayinDto): Promise<{
    status: string;
    address: string;
    amount: number;
    currency: string;
    reference: string;
    expiresAt: Date;
  }> {
    console.log('₿ Crypto PAYIN (On-chain Bitcoin):', data);

    try {
      const amountSat = this.convertToSatoshis(data.amount, data.currency);

      // Generate address for receiving payment
      const addressInfo = await this.blinkApi.getBitcoinAddress();

      // Set expiry to 24 hours for on-chain payments
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      return {
        status: 'ADDRESS_GENERATED',
        address: addressInfo.address,
        amount: amountSat,
        currency: data.currency,
        reference: data.reference,
        expiresAt,
      };
    } catch (error) {
      console.error('❌ Crypto PAYIN failed:', error);
      throw error;
    }
  }

  /**
   * PAYOUT: Send BTC on-chain to recipient
   * 
   * When we need to send on-chain Bitcoin to recipient:
   * 1. Recipient provides BTC address
   * 2. We send transaction on-chain
   * 3. Transaction is broadcast to network
   * 4. Confirmation takes 10-60 minutes depending on fee
   * 
   * Note: This is more expensive than Lightning due to blockchain fees
   * Only use when recipient requires on-chain Bitcoin
   * 
   * @param data Payment output: amount (in satoshis), currency, phone (BTC address), reference
   * @returns Transaction confirmation
   */
  async payout(data: PayoutDto): Promise<{
    status: string;
    amount: number;
    currency: string;
    fee: number;
    txId?: string;
    reference: string;
    estimatedConfirmation: Date;
  }> {
    console.log('₿ Crypto PAYOUT (On-chain Bitcoin):', data);

    try {
      const amountSat = this.convertToSatoshis(data.amount, data.currency);

      // Check account balance before sending
      const balance = await this.blinkApi.getAccountBalance();
      if (balance.btc < amountSat) {
        throw new Error(
          `Insufficient balance. Required: ${amountSat} sat, Available: ${balance.btc} sat`,
        );
      }

      // In a real implementation, this would:
      // 1. Create on-chain transaction
      // 2. Sign with private key
      // 3. Broadcast to network
      // For now, return pending status
      
      // Estimate confirmation time (typically 10-60 minutes for standard fee)
      const estimatedConfirmation = new Date();
      estimatedConfirmation.setMinutes(estimatedConfirmation.getMinutes() + 30);

      return {
        status: 'PENDING_BROADCAST',
        amount: amountSat,
        currency: data.currency,
        fee: 1000, // Estimated fee in satoshis
        reference: data.reference,
        estimatedConfirmation,
      };
    } catch (error) {
      console.error('❌ Crypto PAYOUT failed:', error);
      throw error;
    }
  }

  /**
   * Convert currency to satoshis dynamically
   * Supports both BTC and SAT with smart detection
   * 
   * - 1 BTC = 100,000,000 SAT
   * - SAT = satoshis (no conversion)
   * - Smart detection for ambiguous inputs
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

