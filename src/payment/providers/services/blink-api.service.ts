import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';

/**
 * Blink API Service
 * Handles all direct interactions with Blink API
 * Supports Lightning invoices and Bitcoin payments
 * 
 * API: https://dev.blink.sv/
 */
@Injectable()
export class BlinkApiService {
  private apiUrl: string;
  private apiKey: string;
  private accountId: string;
  private configuredWalletId: string | null;

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.apiUrl = this.configService.get<string>(
      'BLINK_API_URL',
      'https://api.blink.sv/graphql',
    ) || 'https://api.blink.sv/graphql';
    this.apiKey = this.configService.get<string>('BLINK_API_KEY') || '';
    this.accountId = this.configService.get<string>('BLINK_ACCOUNT_ID') || '';
    this.configuredWalletId = this.configService.get<string>('BLINK_WALLET_ID') || null;

    if (!this.apiKey || !this.accountId) {
      throw new Error(
        'Missing BLINK_API_KEY or BLINK_ACCOUNT_ID environment variables',
      );
    }

    // Log configuration status
    if (this.configuredWalletId) {
      console.log('✅ Using configured wallet ID from BLINK_WALLET_ID');
    } else {
      console.log('⚠️  No BLINK_WALLET_ID configured - will query API (slower)');
    }
  }

  /**
   * Get the wallet ID for the account
   * First tries environment variable (fast), then queries API (slower)
   * 
   * @returns BTC wallet ID
   */
  async getDefaultWalletId(): Promise<string> {
    // Use configured wallet ID if available (NO API CALL)
    if (this.configuredWalletId) {
      console.log('💨 Using configured wallet ID (no API call)');
      return this.configuredWalletId;
    }

    // Fallback to API call if not configured
    console.log('🔄 Wallet ID not configured - querying API...');
    try {
      const query = `
        query GetMe {
          me {
            defaultAccount {
              defaultWallet {
                id
              }
            }
          }
        }
      `;

      const response = await this.executeGraphQL(query);
      const walletId = response.data?.me?.defaultAccount?.defaultWallet?.id;
      
      if (!walletId) {
        throw new Error('Could not retrieve default wallet ID');
      }

      console.log('✅ Default wallet ID retrieved from API:', walletId.substring(0, 8) + '...');
      return walletId;
    } catch (error) {
      console.error('❌ Failed to get default wallet ID:', error);
      throw error;
    }
  }

  /**
   * Create a Lightning invoice to receive payments
   * Used for PAYIN (customer sends payment to us)
   * 
   * @param amountSat Amount in satoshis
   * @param description Invoice description/memo
   * @param reference Unique reference for invoice tracking
   * @returns Invoice object with paymentRequest (QR/invoice string)
   */
  async createInvoice(
    amountSat: number,
    description: string,
    reference: string,
  ): Promise<{
    id: string;
    paymentRequest: string;
    amount: number;
    expiresAt: Date;
    status: string;
  }> {
    try {
      // Get the default wallet ID
      const walletId = await this.getDefaultWalletId();

      const mutation = `
        mutation CreateInvoice($input: LnInvoiceCreateInput!) {
          lnInvoiceCreate(input: $input) {
            invoice {
              paymentHash
              paymentRequest
              paymentStatus
              createdAt
              externalId
            }
            errors {
              message
            }
          }
        }
      `;

      const variables = {
        input: {
          walletId,
          amount: amountSat, // Amount as number in satoshis
          memo: description,
        },
      };

      const response = await this.executeGraphQL(mutation, variables);

      if (response.data?.lnInvoiceCreate?.errors?.length > 0) {
        throw new BadRequestException(
          `Blink Invoice Creation Error: ${response.data.lnInvoiceCreate.errors[0].message}`,
        );
      }

      const invoice = response.data?.lnInvoiceCreate?.invoice;
      if (!invoice) {
        throw new InternalServerErrorException('Failed to create Lightning invoice');
      }

      // Calculate expiry (1 hour from now)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      return {
        id: invoice.paymentHash || invoice.externalId, // Use paymentHash as ID
        paymentRequest: invoice.paymentRequest,
        amount: amountSat,
        expiresAt,
        status: invoice.paymentStatus || 'PENDING',
      };
    } catch (error) {
      console.error('❌ Blink createInvoice error:', error);
      throw error;
    }
  }

  /**
   * Check invoice payment status
   * Used to verify if payment has been received
   * 
   * @param invoiceId Invoice ID from createInvoice
   * @returns Payment status and details
   */
  async getInvoiceStatus(invoiceId: string): Promise<{
    id: string;
    status: string;
    paid: boolean;
    paidAmount?: number;
    paidAt?: Date;
  }> {
    try {
      const query = `
        query GetInvoice($id: ID!) {
          lnInvoice(id: $id) {
            id
            status
            satoshis
            expiresAt
            createdAt
            confirmedAt
          }
        }
      `;

      const variables = { id: invoiceId };
      const response = await this.executeGraphQL(query, variables);

      const invoice = response.data?.lnInvoice;
      if (!invoice) {
        throw new BadRequestException('Invoice not found');
      }

      const paid = invoice.confirmedAt !== null;
      return {
        id: invoice.id,
        status: invoice.status,
        paid,
        paidAmount: paid ? parseInt(invoice.satoshis) : undefined,
        paidAt: paid ? new Date(invoice.confirmedAt) : undefined,
      };
    } catch (error) {
      console.error('❌ Blink getInvoiceStatus error:', error);
      throw error;
    }
  }

  /**
   * Pay a Lightning invoice
   * Used for PAYOUT (we send payment to recipient)
   * 
   * @param paymentRequest Lightning invoice/payment request string
   * @param memo Payment memo/reference
   * @returns Payment result with transaction details
   */
  async payLightningInvoice(
    paymentRequest: string,
    memo?: string,
  ): Promise<{
    status: string;
    hash?: string;
    amount: number;
    fee: number;
    timestamp: Date;
  }> {
    try {
      // Get the default wallet ID
      const walletId = await this.getDefaultWalletId();

      const mutation = `
        mutation PayInvoice($input: LnInvoicePaymentInput!) {
          lnInvoicePaymentSend(input: $input) {
            status
            errors {
              message
            }
          }
        }
      `;

      const variables = {
        input: {
          walletId,
          paymentRequest,
          memo: memo || 'TchokoPay Payment',
        },
      };

      const response = await this.executeGraphQL(mutation, variables);

      if (response.data?.lnInvoicePaymentSend?.errors?.length > 0) {
        throw new BadRequestException(
          `Blink Payment Error: ${response.data.lnInvoicePaymentSend.errors[0].message}`,
        );
      }

      const status = response.data?.lnInvoicePaymentSend?.status;
      if (!status) {
        throw new InternalServerErrorException('Failed to pay Lightning invoice');
      }

      // Parse the payment request to get amount
      const amount = this.getAmountFromPaymentRequest(paymentRequest);

      return {
        status,
        amount,
        fee: 0, // Blink API handles fee calculation, can be retrieved from transaction
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('❌ Blink payLightningInvoice error:', error);
      throw error;
    }
  }

  /**
   * Get on-chain Bitcoin address for receiving payments
   * Used when customer wants to pay via on-chain Bitcoin
   * 
   * @returns Bitcoin address and conversion rate
   */
  async getBitcoinAddress(): Promise<{
    address: string;
    accountId: string;
  }> {
    try {
      const query = `
        query GetAccount($id: ID!) {
          account(id: $id) {
            id
            walletCurrencies {
              id
              code
            }
            defaultWalletId
          }
        }
      `;

      const variables = { id: this.accountId };
      const response = await this.executeGraphQL(query, variables);

      const account = response.data?.account;
      if (!account) {
        throw new BadRequestException('Account not found');
      }

      // This is a simplified version - in production, you'd need to
      // get or create a specific on-chain address
      return {
        address: account.id, // Placeholder - actual implementation needs wallet address
        accountId: account.id,
      };
    } catch (error) {
      console.error('❌ Blink getBitcoinAddress error:', error);
      throw error;
    }
  }

  /**
   * Execute GraphQL query/mutation against Blink API
   * 
   * @param query GraphQL query or mutation string
   * @param variables Variables for the query
   * @returns GraphQL response
   */
  private async executeGraphQL(query: string, variables?: Record<string, any>) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.apiUrl,
          {
            query,
            variables: variables || {},
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': this.apiKey,
            },
          },
        ),
      );

      if (response.data?.errors) {
        const errorMessages = response.data.errors
          .map((e: any) => e.message || JSON.stringify(e))
          .join('; ');
        console.error('❌ GraphQL Errors:', errorMessages);
        throw new BadRequestException(
          `GraphQL Error: ${errorMessages}`,
        );
      }

      return response.data;
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      const errorMessage = axiosError?.message || 'Unknown error';
      const status = axiosError?.response?.status || 'unknown';
      const responseData = axiosError?.response?.data as any;
      
      // Extract GraphQL errors if available
      const graphqlErrors = responseData?.errors
        ?.map((e: any) => e.message || JSON.stringify(e))
        .join('; ');
      
      console.error('❌ GraphQL Request Failed:', {
        message: errorMessage,
        status,
        graphqlErrors,
        apiUrl: this.apiUrl,
        hasApiKey: !!this.apiKey,
        hasAccountId: !!this.accountId,
        fullResponse: responseData,
      });
      
      throw new InternalServerErrorException(
        `Blink API Error: ${graphqlErrors || errorMessage}`,
      );
    }
  }

  /**
   * Extract satoshi amount from Lightning payment request
   * Format: lnbc{amount}{unit}...
   * Units: m (milli-satoshi = 0.001), u (micro = 0.000001), n (nano = 0.000000001), p (pico = 0.000000000001)
   * 
   * @param paymentRequest Lightning invoice string
   * @returns Amount in satoshis
   */
  private getAmountFromPaymentRequest(paymentRequest: string): number {
    const match = paymentRequest.match(/^lnbc(\d+)([munp]?)/) || [];
    const amount = parseInt(match[1]) || 0;
    const unit = match[2] || '';

    switch (unit) {
      case 'm': // millisat: 0.001 sat
        return amount / 1000;
      case 'u': // microsat: 0.000001 sat
        return amount / 1000000;
      case 'n': // nanosat: 0.000000001 sat
        return amount / 1000000000;
      case 'p': // picosat: 0.000000000001 sat
        return amount / 1000000000000;
      default:
        // No unit means satoshis
        return amount;
    }
  }

  /**
   * Get account balance
   * Useful for checking available funds before payout
   * 
   * @returns Account balance in satoshis
   */
  async getAccountBalance(): Promise<{
    btc: number; // in satoshis
    usd: number;
  }> {
    try {
      const query = `
        query GetAccount($id: ID!) {
          account(id: $id) {
            id
            wallets {
              id
              label
              balanceAmount {
                amount
                currency
              }
            }
          }
        }
      `;

      const variables = { id: this.accountId };
      const response = await this.executeGraphQL(query, variables);

      const account = response.data?.account;
      if (!account || !account.wallets) {
        throw new BadRequestException('Could not retrieve account balance');
      }

      let btcBalance = 0;
      let usdBalance = 0;

      for (const wallet of account.wallets) {
        const amount = parseInt(wallet.balanceAmount.amount || '0');
        if (wallet.balanceAmount.currency === 'BTC') {
          btcBalance = amount;
        } else if (wallet.balanceAmount.currency === 'USD') {
          usdBalance = amount;
        }
      }

      return { btc: btcBalance, usd: usdBalance };
    } catch (error) {
      console.error('❌ Blink getAccountBalance error:', error);
      throw error;
    }
  }
}
