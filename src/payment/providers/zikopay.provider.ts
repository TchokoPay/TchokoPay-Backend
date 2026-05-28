/**
 * ZikoPay Payment Provider
 *
 * Supports West + Central African mobile money.
 * Used as secondary aggregator (priority 2) — Netwalletpay is primary.
 *
 * Docs: https://docs.zikopay.com/docs/category/api-reference
 *
 * Auth:     X-API-Key + X-API-Secret headers
 * Payin:    POST /v1/payments/payin/mobile-money
 * Payout:   POST /v1/payments/payout/mobile-money
 * Status:   GET  /payment/status/{reference}
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PaymentProvider } from './base/payment-provider.interface.js';
import { PayinDto, PayoutDto } from './base/types.js';

const ZIKOPAY_STATUSES: Record<string, 'SUCCESS' | 'FAILED' | 'PENDING'> = {
  completed:   'SUCCESS',
  failed:      'FAILED',
  cancelled:   'FAILED',
  expired:     'FAILED',
  pending:     'PENDING',
  processing:  'PENDING',
};

@Injectable()
export class ZikoPayProvider implements PaymentProvider {
  private readonly logger = new Logger(ZikoPayProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly webhookBase: string;
  private readonly returnUrl: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.baseUrl     = (configService.get<string>('ZIKOPAY_BASE_URL') ?? 'https://api.payment.zikopay.com').replace(/\/+$/, '');
    this.apiKey      = configService.get<string>('ZIKOPAY_API_KEY')    ?? '';
    this.apiSecret   = configService.get<string>('ZIKOPAY_API_SECRET') ?? '';
    this.webhookBase = configService.get<string>('NETWALLETPAY_WEBHOOK_BASE_URL') ?? '';
    this.returnUrl   = configService.get<string>('FRONTEND_APP_URL') ?? 'https://tchokopay.com';

    if (!this.apiKey || !this.apiSecret) {
      this.logger.warn('⚠️ ZikoPay credentials not configured — ZIKOPAY_API_KEY / ZIKOPAY_API_SECRET missing');
    } else {
      this.logger.log(`🚀 ZikoPay Provider initialised [${this.baseUrl}]`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private get headers(): Record<string, string> {
    return {
      'X-API-Key':    this.apiKey,
      'X-API-Secret': this.apiSecret,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    };
  }

  /** Format phone to plain international digits (no +). E.g. 237670000000 */
  private formatPhone(phone: string, dialCode: string): string {
    const digits = phone.replace(/[\s+\-()]/g, '');
    const cc = dialCode.replace('+', '');
    if (digits.startsWith('00')) return digits.slice(2);
    if (digits.startsWith(cc)) return digits;
    const local = digits.startsWith('0') ? digits.slice(1) : digits;
    return cc + local;
  }

  /**
   * Resolve the ZikoPay operator code from the provider code stored in DB.
   * ZikoPay codes are prefixed with 'ziko_' in our DB; strip it to get their code.
   * E.g. 'ziko_mtn_cm' → 'mtn_cm'
   */
  private async resolveOperatorCode(
    country: string,
    method: string,
    preferredProviderCode?: string,
  ): Promise<{ operatorCode: string; providerName: string; dialCode: string }> {
    const provider = await this.prisma.paymentProvider.findFirst({
      where: {
        aggregator: { code: 'zikopay', isActive: true },
        country:    { iso2: country, isActive: true },
        method:     { code: method, isActive: true },
        isActive:   true,
        ...(preferredProviderCode ? { providerCode: preferredProviderCode } : {}),
      },
      include: { country: true },
    });

    if (!provider) {
      // Fallback: any active ZikoPay provider for this country
      const fallback = await this.prisma.paymentProvider.findFirst({
        where: {
          aggregator: { code: 'zikopay', isActive: true },
          country:    { iso2: country, isActive: true },
          isActive:   true,
        },
        include: { country: true },
      });
      if (!fallback) throw new Error(`No active ZikoPay provider for ${country}`);
      const code = fallback.providerCode.replace(/^ziko_/, '');
      return { operatorCode: code, providerName: fallback.name, dialCode: fallback.country.dialCode ?? '' };
    }

    const code = provider.providerCode.replace(/^ziko_/, '');
    return { operatorCode: code, providerName: provider.name, dialCode: provider.country.dialCode ?? '' };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    this.logger.log(`📡 ZikoPay ${method} ${url}`);
    if (body) this.logger.log(`   Payload: ${JSON.stringify(body)}`);

    const res = await fetch(url, {
      method,
      headers: this.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data = await res.json() as Record<string, unknown>;
    this.logger.log(`   Response [${res.status}]: ${JSON.stringify(data)}`);

    if (!res.ok || data.success === false) {
      throw new Error(String(data.message ?? `ZikoPay error ${res.status}`));
    }

    return data as T;
  }

  // ── PaymentProvider interface ─────────────────────────────────────────────

  async payin(data: PayinDto): Promise<any> {
    const { amount, currency, phone, reference, description, metadata } = data;
    const country  = (metadata?.country as string ?? '').toUpperCase();
    const method   = 'MOBILE_MONEY';
    const preferred = metadata?.providerCode as string | undefined;

    this.logger.log(`🔄 ZikoPay PAYIN: ${amount} ${currency} → ${country} (${phone})`);

    try {
      const { operatorCode, providerName, dialCode } = await this.resolveOperatorCode(country, method, preferred);
      const formattedPhone = this.formatPhone(phone ?? '', dialCode);

      this.logger.log(`📌 operator=${operatorCode} (${providerName})  phone=${phone} → ${formattedPhone}`);

      const response = await this.request<any>('POST', '/v1/payments/payin/mobile-money', {
        amount:       Math.ceil(Number(amount)),
        currency,
        phoneNumber:  formattedPhone,
        operator:     operatorCode,
        return_url:   `${this.returnUrl}/dashboard`,
        callback_url: `${this.webhookBase}/api/v1/webhooks/zikopay`,
        customer: {
          name:  metadata?.payerName  as string || 'Customer',
          phone: formattedPhone,
          email: metadata?.payerEmail as string || 'noreply@tchokopay.com',
        },
        description: description?.trim() || `TchokoPay payment ${reference}`,
      });

      const txRef = (response?.data as any)?.reference as string | undefined;
      this.logger.log(`✅ ZikoPay PAYIN accepted — ref: ${txRef}`);

      return {
        status: 'SUCCESS',
        transactionId: txRef,
        provider: providerName,
        providerCode: operatorCode,
        method,
        country,
        phone,
        formattedPhone,
      };
    } catch (err) {
      this.logger.error(`❌ ZikoPay PAYIN failed: ${(err as Error).message}`);
      return { status: 'FAILED', error: (err as Error).message };
    }
  }

  async payout(data: PayoutDto): Promise<any> {
    const { amount, currency, phone, reference, description, metadata } = data;
    const country   = (metadata?.country as string ?? '').toUpperCase();
    const method    = 'MOBILE_MONEY';
    const preferred = metadata?.providerCode as string | undefined;

    this.logger.log(`💸 ZikoPay PAYOUT: ${amount} ${currency} → ${country} (${phone})`);

    try {
      const { operatorCode, providerName, dialCode } = await this.resolveOperatorCode(country, method, preferred);
      const formattedPhone = this.formatPhone(phone ?? '', dialCode);

      this.logger.log(`📌 operator=${operatorCode} (${providerName})  phone=${phone} → ${formattedPhone}`);

      const response = await this.request<any>('POST', '/v1/payments/payout/mobile-money', {
        amount:       Math.round(Number(amount)),
        currency,
        phoneNumber:  formattedPhone,
        operator:     operatorCode,
        callback_url: `${this.webhookBase}/api/v1/webhooks/zikopay`,
        customer: {
          name:  metadata?.recipientName as string || 'Recipient',
          phone: formattedPhone,
          email: metadata?.recipientEmail as string || 'noreply@tchokopay.com',
        },
        description: description?.trim() || `TchokoPay payout ${reference}`,
      });

      const txRef = (response?.data as any)?.reference as string | undefined;
      this.logger.log(`✅ ZikoPay PAYOUT accepted — ref: ${txRef}`);

      return { status: 'SUCCESS', transactionId: txRef, provider: providerName };
    } catch (err) {
      this.logger.error(`❌ ZikoPay PAYOUT failed: ${(err as Error).message}`);
      return { status: 'FAILED', error: (err as Error).message };
    }
  }

  async checkTransactionStatus(transactionId: string): Promise<{
    status: 'SUCCESS' | 'FAILED' | 'PENDING';
    raw: unknown;
  }> {
    try {
      const response = await this.request<any>('GET', `/payment/status/${transactionId}`);
      const apiStatus = String((response?.data as any)?.status ?? '').toLowerCase();
      const status = ZIKOPAY_STATUSES[apiStatus] ?? 'PENDING';
      return { status, raw: response };
    } catch (err) {
      this.logger.error(`checkTransactionStatus failed for ${transactionId}: ${(err as Error).message}`);
      return { status: 'PENDING', raw: null };
    }
  }

  /** Check if this aggregator is configured and active for a given country/method. */
  async isSupported(country: string, method: string): Promise<boolean> {
    const count = await this.prisma.paymentProvider.count({
      where: {
        aggregator: { code: 'zikopay', isActive: true },
        country:    { iso2: country.toUpperCase(), isActive: true },
        method:     { code: method, isActive: true },
        isActive:   true,
      },
    });
    return count > 0;
  }
}
