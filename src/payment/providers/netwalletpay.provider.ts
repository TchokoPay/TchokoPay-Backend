import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PaymentProvider } from './base/payment-provider.interface.js';
import { PayinDto, PayoutDto } from './base/types.js';
import { detectProviderFromPhone } from './mno-detect.js';

export type NetwalletpayMethod =
  | 'MOBILE_MONEY'
  | 'CARD'
  | 'BANK'
  | 'NETWALLET_PAY'
  | 'CRYPTO';

// Verified 2026-05-12 via GET /api/v1/lookup/get-providers/COLLECTION/MOBILE_MONEY/{country}
export type NetwalletpayCountry =
  | 'CM' | 'KE' | 'TZ' | 'UG' | 'RW' | 'BI' | 'GH'
  | 'NG' | 'ZA' | 'ZM' | 'EG';

interface NetwalletpayConfig {
  primaryKey: string;
  secondaryKey: string;
  email: string;
  baseUrl: string;
  webhookBaseUrl?: string;
  webhookSecret?: string;
}

interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
}

@Injectable()
export class NetwalletpayProvider implements PaymentProvider {
  private readonly logger = new Logger(NetwalletpayProvider.name);
  private config: NetwalletpayConfig;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private supportedMap: Partial<Record<NetwalletpayCountry, Set<NetwalletpayMethod>>> = {};
  private countryCurrencyMap: Partial<Record<NetwalletpayCountry, string>> = {};
  private countryDialCodeMap: Partial<Record<NetwalletpayCountry, string>> = {};
  private countryDataMap: Partial<Record<NetwalletpayCountry, { id: string; name: string; iso2: string; dialCode: string; currencyCode: string }>> = {};

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.config = {
      primaryKey: this.configService.get<string>('NETWALLETPAY_PRIMARY_KEY', ''),
      secondaryKey: this.configService.get<string>('NETWALLETPAY_SECONDARY_KEY', ''),
      email: this.configService.get<string>('NETWALLETPAY_EMAIL', ''),
      baseUrl: this.normalizeBaseUrl(this.configService.get<string>('NETWALLETPAY_BASE_URL', 'https://netwalletpay.com')),
      webhookBaseUrl: this.configService.get<string>('NETWALLETPAY_WEBHOOK_BASE_URL', 'https://your-domain.com'),
      webhookSecret: this.configService.get<string>('NETWALLETPAY_WEBHOOK_SECRET'),
    };

    // Validate required configuration
    if (!this.config.primaryKey || !this.config.secondaryKey || !this.config.email) {
      this.logger.error('❌ Netwalletpay configuration incomplete. Required: NETWALLETPAY_PRIMARY_KEY, NETWALLETPAY_SECONDARY_KEY, NETWALLETPAY_EMAIL');
    }

    this.logger.log('🚀 Netwalletpay Provider initialized', {
      baseUrl: this.config.baseUrl,
      email: this.config.email,
      primaryKeyLength: this.config.primaryKey?.length,
      secondaryKeyLength: this.config.secondaryKey?.length,
    });

    // Load dynamic provider/country data into memory for fast checks
    this.loadProviderMetadata().catch(error => {
      this.logger.warn('⚠️ Could not load provider metadata at startup', error);
    });
  }

  private normalizeBaseUrl(url: string): string {
    return (url || 'https://netwalletpay.com').trim().replace(/\/+$/, '');
  }

  /**
   * Load all provider metadata and country info from database
   */
  private async loadProviderMetadata(): Promise<void> {
    try {
      this.logger.log('🌱 Loading Netwalletpay provider metadata from DB');
      
      // Load all active countries with their currency info
      const countries = await this.prisma.country.findMany({
        where: { isActive: true },
        include: { currency: true },
      });
      
      for (const country of countries) {
        const countryCode = country.iso2 as NetwalletpayCountry;
        this.countryDataMap[countryCode] = {
          id: country.id,
          name: country.name,
          iso2: country.iso2,
          dialCode: country.dialCode || '',
          currencyCode: country.currency?.code || 'USD',
        };
        this.countryCurrencyMap[countryCode] = country.currency?.code || 'USD';
        this.countryDialCodeMap[countryCode] = country.dialCode || '';
      }
      
      // Load only Netwalletpay's providers — aggregator filter prevents future
      // Stripe/Flutterwave records from being treated as supported by this provider
      const providers = await this.prisma.paymentProvider.findMany({
        where: {
          aggregator: { code: 'netwalletpay', isActive: true },
          isActive: true,
          country: { isActive: true },
          method: { isActive: true },
        },
        include: { country: true, method: true },
      });

      for (const provider of providers) {
        const countryCode = provider.country.iso2 as NetwalletpayCountry;
        const methodCode = provider.method.code as NetwalletpayMethod;

        if (!this.supportedMap[countryCode]) {
          this.supportedMap[countryCode] = new Set();
        }
        this.supportedMap[countryCode].add(methodCode);
      }
      
      this.logger.log(`✅ Loaded ${countries.length} countries and ${providers.length} providers`);
    } catch (error) {
      this.logger.error('❌ Failed to load provider metadata:', error);
    }
  }

  private computeHash(orderId: string): string {
    return createHash('sha256')
      .update(`${orderId}_${this.config.secondaryKey}`)
      .digest('hex');
  }

  private normalizeOrderId(reference: string): string {
    return (reference || '').trim().replace(/^(INV|REQ)-/i, '');
  }

  /**
   * Netwalletpay rejects order info containing non-ASCII characters with
   * 4007 "The order information is invalid". Merchant titles/reasons are free
   * text (em-dashes, accents, emoji…), so normalise to a safe ASCII subset and
   * cap the length before sending. Does not affect the Hash (orderId-only).
   */
  private sanitizeDescription(input?: string): string {
    const cleaned = (input ?? '')
      .normalize('NFKD')
      .replace(/[‐-―]/g, '-')
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    return cleaned || 'TchokoPay payment';
  }

  /**
   * Mobile money and bank APIs (Airtel, MTN, M-Pesa, bank transfers) only
   * accept integer amounts. Crypto methods keep full decimal precision.
   * Uses Math.ceil for payin (payer always covers the full amount) and
   * Math.round for payout (neutral rounding, avoid systematic overpayment).
   */
  private normalizeAmount(
    amount: number,
    method: NetwalletpayMethod,
    direction: 'payin' | 'payout',
  ): number {
    if (method === 'CRYPTO') return Number(amount);
    return direction === 'payin'
      ? Math.ceil(Number(amount))
      : Math.round(Number(amount));
  }

  async payin(data: PayinDto): Promise<any> {
    const { amount, currency, reference, phone, metadata } = data;

    // Keep the raw collection method as a provider-selection hint.
    const country = metadata?.country as NetwalletpayCountry;
    const rawPaymentMethod = ((metadata?.method as string) || '').toUpperCase();
    const method = this.mapMethod(rawPaymentMethod);

    this.logger.log(`🔄 Netwalletpay PAYIN: ${method} in ${country} - ${amount} ${currency} to ${phone}`);

    try {
      // Format phone first so we can auto-detect the correct MNO from the prefix.
      const formattedPhone = phone ? await this.formatPhoneNumber(phone, country) : phone;

      // Provider resolution priority:
      //   1. Explicit code from the frontend (user's provider selection) — always trust this.
      //   2. Auto-detect from phone prefix — only when frontend sent no selection.
      //   3. DB default for this country/method — final fallback.
      const explicitProvider = metadata?.providerCode as string | undefined;
      const detectedProvider = explicitProvider
        ? null  // skip auto-detect when user made an explicit selection
        : (formattedPhone ? detectProviderFromPhone(formattedPhone, country) : null);

      const resolvedProvider = explicitProvider ?? detectedProvider ?? undefined;
      this.logger.log(
        `🔍 Provider resolved: ${resolvedProvider ?? 'DB default'} ` +
        `[explicit=${explicitProvider ?? '-'} detected=${detectedProvider ?? '-'}]`,
      );

      const providerInfo = await this.getProviderInfo(
        'COLLECTION',
        method,
        country,
        rawPaymentMethod,
        resolvedProvider,
      );
      const providerId = providerInfo.id;
      const methodType = providerInfo.methodType || this.getMethodType(country, method, providerId);

      this.logger.log(`📌 PAYIN Configuration:`, {
        country,
        method,
        rawPaymentMethod,
        methodType,
        providerId,
        providerName: providerInfo.name,
        amount: Number(amount), // Keep decimal precision for accurate amounts
        currency,
        phone,
        formattedPhone,
      });

      // Build collection request payload using API spec parameter names
      const orderId = this.normalizeOrderId(reference);
      const payload: any = {
        CurrencyCode: currency,
        OrderID: orderId,
        Amount: this.normalizeAmount(amount, method, 'payin'),
        Method: method,
        CountryCode: country,
        MethodProvider: providerId,
        PhoneNumber: formattedPhone,
        Description: this.sanitizeDescription(data.description || `Payment for ${reference}`),
        CallbackUrl: `${this.config.webhookBaseUrl}/api/v1/webhooks/netwalletpay`,
        Hash: this.computeHash(orderId),
      };

      // Add MethodType only for MOBILE_MONEY method in Cameroon
      if (method === 'MOBILE_MONEY' && country === 'CM') {
        payload.MethodType = methodType;
      }

      this.logger.log(`💲 PAYIN Request Payload:`, payload);
      this.logger.log(`📱 Formatted phone: ${phone} → ${formattedPhone}`);
      this.logger.log(`🆔 OrderID: ${reference} → ${orderId}`);

      // Validate required parameters
      const requiredParams = ['CurrencyCode', 'OrderID', 'Amount', 'Method', 'CountryCode', 'MethodProvider', 'PhoneNumber'];
      const missingParams = requiredParams.filter(param => !payload[param]);
      if (missingParams.length > 0) {
        const error = `Missing required parameters: ${missingParams.join(', ')}`;
        this.logger.error(`❌ PAYIN Validation Error: ${error}`, payload);
        throw new Error(error);
      }

      const response = await this.postWithMethodProviderFallback(
        '/api/v1/global/collection/request-payment',
        payload
      );

      this.logger.log(`✅ PAYIN Success:`, {
        transactionId: response.data,
        statusCode: response.statusCode,
        message: response.message,
      });

      return {
        status: 'SUCCESS',
        transactionId: response.data,
        provider: providerInfo.name,
        providerCode: providerId,
        method: method,
        country: country,
        phone,
        formattedPhone,
      };
    } catch (error) {
      this.logger.error(`❌ Netwalletpay PAYIN failed:`, error);
      return {
        status: 'FAILED',
        error: (error as Error).message,
      };
    }
  }

  /**
   * Payout (Disbursement) - We pay out to customer
   */
  async payout(data: PayoutDto): Promise<any> {
    const { amount, currency, phone, reference, metadata } = data;

    const country = metadata?.country as NetwalletpayCountry;
    // Keep the raw payout method hint ('ORANGE', 'MOMO', etc.) BEFORE mapping it to
    // the Netwalletpay method code ('MOBILE_MONEY'). This hint drives provider selection
    // so that Orange payouts use orange_cm and MOMO payouts use mtn_cm.
    const rawPayoutMethod = ((metadata?.method as string) || '').toUpperCase();
    const method = this.mapMethod(rawPayoutMethod);

    this.logger.log(
      `💸 Netwalletpay PAYOUT: ${method} (${rawPayoutMethod}) in ${country} - ${amount} ${currency} to ${phone}`,
    );

    try {
      // Format phone first so we can auto-detect the correct MNO from the prefix.
      const formattedPhone = phone ? await this.formatPhoneNumber(phone, country) : phone;

      // Provider resolution priority (same as payin):
      //   1. Explicit code from frontend (user's selection) — trust this first.
      //   2. Auto-detect from recipient's phone prefix — only when no explicit code.
      //   3. DB default for this country/method — final fallback.
      const explicitProvider = metadata?.providerCode as string | undefined;
      const detectedProvider = explicitProvider
        ? null
        : (formattedPhone ? detectProviderFromPhone(formattedPhone, country) : null);

      const resolvedProvider = explicitProvider ?? detectedProvider ?? undefined;
      this.logger.log(
        `🔍 Payout provider resolved: ${resolvedProvider ?? 'DB default'} ` +
        `[explicit=${explicitProvider ?? '-'} detected=${detectedProvider ?? '-'}]`,
      );

      const providerInfo = await this.getProviderInfo(
        'PAYOUT',
        method,
        country,
        rawPayoutMethod,
        resolvedProvider,
      );
      const providerId = providerInfo?.methodProviderId || providerInfo?.id || 'mtn_cm';
      const methodType = this.getMethodType(country, method, providerInfo?.id);

      this.logger.log(`📌 PAYOUT Configuration:`, {
        country,
        method,
        methodType,
        providerId,
        methodProviderId: providerInfo?.methodProviderId,
        providerName: providerInfo?.name,
        amount: Number(amount), // Keep decimal precision for accurate amounts
        currency,
        phone,
        formattedPhone,
      });

      // Build payout request payload using API spec parameter names
      const orderId = this.normalizeOrderId(reference);
      const payload: any = {
        CurrencyCode: currency,
        OrderID: orderId,
        Amount: this.normalizeAmount(amount, method, 'payout'),
        Method: method,
        CountryCode: country,
        MethodProvider: providerId,
        PhoneNumber: formattedPhone,
        Description: this.sanitizeDescription(data.description || `Payout for ${reference}`),
        CallbackUrl: `${this.config.webhookBaseUrl}/api/v1/webhooks/netwalletpay`,
        Hash: this.computeHash(orderId),
      };

      // Add MethodType only for MOBILE_MONEY method
      if (methodType && method === 'MOBILE_MONEY') {
        payload.MethodType = methodType;
      }

      this.logger.log(`💲 PAYOUT Request Payload:`, payload);
      this.logger.log(`📱 Formatted phone: ${phone} → ${formattedPhone}`);
      this.logger.log(`🆔 OrderID: ${reference} → ${orderId}`);

      // Validate required parameters
      const requiredParams = ['CurrencyCode', 'OrderID', 'Amount', 'Method', 'CountryCode', 'MethodProvider', 'PhoneNumber'];
      const missingParams = requiredParams.filter(param => !payload[param]);
      if (missingParams.length > 0) {
        const error = `Missing required parameters: ${missingParams.join(', ')}`;
        this.logger.error(`❌ PAYOUT Validation Error: ${error}`, payload);
        throw new Error(error);
      }

      const response = await this.postWithMethodProviderFallback(
        '/api/v1/global/payout/request-transfer',
        payload
      );

      this.logger.log(`✅ PAYOUT Success:`, {
        transactionId: response.data,
        statusCode: response.statusCode,
        message: response.message,
      });

      return {
        status: 'SUCCESS',
        transactionId: response.data,
        provider: providerInfo?.name,
        method,
        country,
      };
    } catch (error) {
      this.logger.error(`❌ Netwalletpay PAYOUT failed:`, error);
      return {
        status: 'FAILED',
        error: (error as Error).message,
      };
    }
  }

  /**
   * Poll the Netwalletpay API for a transaction's current status.
   * Returns a normalised status: 'SUCCESS' | 'FAILED' | 'PENDING'
   */
  async checkTransactionStatus(transactionId: string): Promise<{
    status: 'SUCCESS' | 'FAILED' | 'PENDING';
    raw: any;
  }> {
    try {
      const response = await this.makeApiRequest(
        'GET',
        `/api/v1/global/transaction-status/${transactionId}`,
      );

      const raw = response.data ?? response;
      const apiStatus = (raw?.status ?? '').toUpperCase();

      let status: 'SUCCESS' | 'FAILED' | 'PENDING';
      if (apiStatus === 'SUCCESS' || apiStatus === 'COMPLETED') {
        status = 'SUCCESS';
      } else if (apiStatus === 'FAILED' || apiStatus === 'CANCELLED' || apiStatus === 'TIMEOUT') {
        status = 'FAILED';
      } else {
        status = 'PENDING';
      }

      return { status, raw };
    } catch (error) {
      this.logger.error(`checkTransactionStatus failed for ${transactionId}:`, error);
      return { status: 'PENDING', raw: null };
    }
  }

  /**
   * Verify provider configuration by querying Netwalletpay API
   * This is useful for debugging and testing the integration
   */
  async verifyProviderConfig(paymentType: 'COLLECTION' | 'PAYOUT', method: string, country: string): Promise<any> {
    try {
      const endpoint = `/api/v1/lookup/get-providers/${paymentType}/${method}/${country}`;
      this.logger.log(`🔍 Verifying provider config: ${endpoint}`);

      const response = await this.makeApiRequest('GET', endpoint);

      const result = {
        status: 'SUCCESS',
        endpoint,
        paymentType,
        method,
        country,
        providersCount: Array.isArray(response.data) ? response.data.length : 0,
        providers: response.data || [],
        message: response.message,
      };

      this.logger.log(`✅ Provider verification successful:`, result);
      return result;
    } catch (error) {
      this.logger.error(`❌ Provider verification failed:`, error);
      return {
        status: 'FAILED',
        error: (error as Error).message,
        paymentType,
        method,
        country,
      };
    }
  }

  /**
   * Get supported countries from database
   */
  async getSupportedCountries(): Promise<any[]> {
    try {
      this.logger.log('🌍 Fetching supported countries from database');
      
      const countries = await this.prisma.country.findMany({
        where: { isActive: true },
        include: { currency: true },
      });

      const result = countries.map(c => ({
        countryCode: c.iso2,
        currencyCode: c.currency?.code || 'USD',
        countryName: c.name,
        dialCode: c.dialCode,
      }));

      this.logger.log(`✅ Retrieved ${result.length} active countries from database`);
      return result;
    } catch (error) {
      this.logger.error('❌ Failed to get supported countries:', error);
      return [];
    }
  }

  /**
   * Get provider information for country and method
   */
  private async getProviderInfo(
    paymentType: 'COLLECTION' | 'PAYOUT',
    method: NetwalletpayMethod,
    country: NetwalletpayCountry,
    /** Raw method hint before mapping (e.g. 'ORANGE', 'MOMO') — used to pick the right sub-provider */
    methodHint?: string,
    preferredProviderCode?: string,
  ): Promise<any> {
    try {
      // First try the dynamic DB configuration so provider selection is data-driven
      const dbProvider = await this.getProviderFromDb(country, method, methodHint, preferredProviderCode);
      if (dbProvider) {
        this.logger.log(`🔍 Using DB provider config for ${country}/${method}`, { dbProvider });
        return dbProvider;
      }

      // Fallback to external API call when no DB config exists
      const endpoint = `/api/v1/lookup/get-providers/${paymentType}/${method}/${country}`;
      this.logger.log(`🔍 Fetching provider info from Netwalletpay API:`, { endpoint, paymentType, method, country });

      const response = await this.makeApiRequest('GET', endpoint);

      this.logger.log(`✅ Provider lookup response:`, {
        statusCode: response.statusCode,
        dataType: Array.isArray(response.data) ? 'array' : typeof response.data,
        dataLength: Array.isArray(response.data) ? response.data.length : 'N/A',
        providersData: response.data,
        message: response.message,
      });

      const providers = response.data || [];
      if (providers.length === 0) {
        this.logger.warn(`No providers found for ${paymentType}/${method}/${country}, using default`);
        return await this.getDefaultProvider(country, method);
      }

      let selectedProvider = this.selectBestProvider(providers, country, paymentType, method, methodHint);
      selectedProvider.methodType = (method === 'MOBILE_MONEY' && country === 'CM')
        ? this.getMethodTypeForProvider(selectedProvider.id)
        : '';
      selectedProvider.providerName = selectedProvider.name;

      // upsert to DB for next time
      await this.upsertProviderToDb(country, method, selectedProvider);

      this.logger.log(`🎯 Selected provider for ${paymentType}:`, selectedProvider);
      return selectedProvider;
    } catch (error) {
      this.logger.error(`❌ Failed to get provider info for ${paymentType}/${method}/${country}:`, error);
      return await this.getDefaultProvider(country, method);
    }
  }

  /**
   * Select the best provider based on country, payment type, and method
   */
  private selectBestProvider(providers: any[], country: NetwalletpayCountry, paymentType: string, method: NetwalletpayMethod, methodHint?: string): any {
    // For Cameroon mobile money, prefer providers in this order
    if (country === 'CM' && method === 'MOBILE_MONEY') {
      const hint = methodHint?.toUpperCase();
      if (hint === 'ORANGE') {
        return providers.find((p: any) => p.id === 'orange_cm') ||
               providers.find((p: any) => p.id === 'mtn_cm') ||
               providers.find((p: any) => p.id === 'eu_cm') ||
               providers.find((p: any) => p.id === 'netwallet_cm') ||
               providers[0];
      }

      if (paymentType === 'PAYOUT') {
        // For payout, prefer MTN first (most reliable), then Orange, then others
        return providers.find((p: any) => p.id === 'mtn_cm') ||
               providers.find((p: any) => p.id === 'orange_cm') ||
               providers.find((p: any) => p.id === 'eu_cm') ||
               providers.find((p: any) => p.id === 'netwallet_cm') ||
               providers[0];
      } else {
        // For collection, prefer MTN first, then Orange, then EU, then others
        return providers.find((p: any) => p.id === 'mtn_cm') ||
               providers.find((p: any) => p.id === 'orange_cm') ||
               providers.find((p: any) => p.id === 'eu_cm') ||
               providers.find((p: any) => p.id === 'netwallet_cm') ||
               providers[0];
      }
    }

    // For other countries, use the first available provider
    return providers[0];
  }

  /**
   * Get MethodType for a specific provider ID
   */
  private getMethodTypeForProvider(providerId: string): string {
    const normalizedId = providerId?.toLowerCase() || '';

    // Netwalletpay doc specifies MethodType values: MOMO, ORANGE_MONEY, EU
    if (normalizedId.includes('mtn')) {
      return 'MOMO'; // MTN uses MOMO method type
    } else if (normalizedId.includes('orange')) {
      return 'ORANGE_MONEY'; // Orange uses ORANGE_MONEY
    } else if (normalizedId.includes('eu')) {
      return 'EU';
    } else if (normalizedId.includes('netwallet')) {
      return 'MOMO'; // Default to MOMO for unknown providers
    }

    return 'MOMO'; // Default fallback for Cameroon mobile money
  }

  /**
   * Get a list of fallback MethodType candidates for a provider ID.
   */
  private getMethodTypeCandidates(providerId: string): string[] {
    const normalizedId = (providerId || '').toLowerCase();
    const candidates: string[] = [];

    // provider-specific method types with prioritized order per Netwalletpay docs
    if (normalizedId.includes('mtn')) {
      candidates.push('MOMO', 'EU');
    } else if (normalizedId.includes('orange')) {
      candidates.push('ORANGE_MONEY', 'EU', 'MOMO');
    } else if (normalizedId.includes('eu')) {
      candidates.push('EU', 'MOMO', 'ORANGE_MONEY');
    } else if (normalizedId.includes('netwallet')) {
      candidates.push('MOMO', 'EU', 'ORANGE_MONEY');
    }

    // Generic fallbacks
    candidates.push('MOMO', 'EU', 'ORANGE_MONEY');

    // Remove duplicates keeping order
    return Array.from(new Set(candidates));
  }

  /**
   * Get default provider from database based on country and method
   */
  private async getDefaultProvider(country: NetwalletpayCountry, method: NetwalletpayMethod): Promise<any> {
    try {
      // Query DB for first available provider for this country/method
      // Order by providerCode to ensure MTN (mtn_cm) is preferred when multiple providers exist
      const allProviders = await this.prisma.paymentProvider.findMany({
        where: {
          aggregator: { code: 'netwalletpay', isActive: true },
          country: { iso2: country, isActive: true },
          method: { code: method, isActive: true },
          isActive: true,
        },
        include: {
          country: { include: { currency: true } },
          method: true,
        },
      });

      const priority = ['mtn_cm', 'orange_cm', 'netwallet_cm', 'eu_cm'];
      const provider = allProviders.length
        ? (priority.reduce<(typeof allProviders)[0] | null>((found, code) => found ?? allProviders.find(p => p.providerCode === code) ?? null, null) ?? allProviders[0])
        : null;

      if (provider) {
        return {
          id: provider.providerCode,
          name: provider.name,
          methodType: provider.requiresType ? this.getMethodTypeForProvider(provider.providerCode) : '',
          country,
          transactionCurrency: provider.country.currency?.code || 'USD',
        };
      }

      // Fallback: any active provider for this country
      const anyProvider = await this.prisma.paymentProvider.findFirst({
        where: {
          country: { iso2: country, isActive: true },
          isActive: true,
        },
        include: {
          country: { include: { currency: true } },
          method: true,
        },
      });

      if (anyProvider) {
        return {
          id: anyProvider.providerCode,
          name: anyProvider.name,
          methodType: anyProvider.requiresType ? anyProvider.method.code : '',
          country,
          transactionCurrency: anyProvider.country.currency?.code || 'USD',
        };
      }

      this.logger.warn(`No provider found in DB for ${country}/${method}`);
      return {
        id: 'mtn_cm',
        name: 'MTN Mobile Money',
        methodType: method === 'MOBILE_MONEY' ? 'MOMO' : '',
        country,
        transactionCurrency: await this.getCurrencyForCountry(country),
      };
    } catch (error) {
      this.logger.error(`Failed to get default provider for ${country}/${method}:`, error);
      return {
        id: 'mtn_cm',
        name: 'MTN Mobile Money',
        methodType: method === 'MOBILE_MONEY' ? 'MOMO' : '',
        country,
        transactionCurrency: 'USD',
      };
    }
  }

  /**
   * Get provider from DB, preferring the sub-network that matches methodHint.
   * For Cameroon MOBILE_MONEY: 'ORANGE' → orange_cm first; 'MOMO' → mtn_cm first.
   */
  private async getProviderFromDb(
    country: NetwalletpayCountry,
    method: NetwalletpayMethod,
    methodHint?: string,
    preferredProviderCode?: string,
  ): Promise<any> {
    const mappedMethod = method === 'NETWALLET_PAY' ? 'NETWALLET_PAY' : method;

    const providers = await this.prisma.paymentProvider.findMany({
      where: {
        // Scope strictly to Netwalletpay — prevents future aggregator records leaking in
        aggregator: { code: 'netwalletpay', isActive: true },
        country: { iso2: country, isActive: true },
        method: { code: mappedMethod, isActive: true },
        isActive: true,
      },
      include: {
        country: { include: { currency: true } },
        method: true,
      },
    });

    if (!providers.length) return null;

    // Build priority based on the raw method hint so the correct sub-network is chosen.
    // Without this, Orange payouts would incorrectly use the MTN provider (→ error 4005).
    const hint = methodHint?.toUpperCase();
    const priority = [
      ...(preferredProviderCode ? [preferredProviderCode.toLowerCase()] : []),
      ...(hint === 'ORANGE'
        ? ['orange_cm', 'mtn_cm', 'netwallet_cm', 'eu_cm']
        : hint === 'MOMO'
          ? ['mtn_cm', 'orange_cm', 'netwallet_cm', 'eu_cm']
          : ['mtn_cm', 'orange_cm', 'netwallet_cm', 'eu_cm']),
    ];

    const provider =
      priority.reduce<(typeof providers)[0] | null>(
        (found, code) =>
          found ?? providers.find((p) => p.providerCode === code) ?? null,
        null,
      ) ?? providers[0];

    return {
      id: provider.providerCode,
      name: provider.name,
      methodProviderId: provider.providerCode,
      country: provider.country.iso2,
      methodType: provider.requiresType ? this.getMethodTypeForProvider(provider.providerCode) : '',
      transactionCurrency: provider.country.currency?.code || 'USD',
    };
  }

  private async upsertProviderToDb(country: NetwalletpayCountry, method: NetwalletpayMethod, providerData: any) {
    const currencyCode = this.countryCurrencyMap[country] || 'USD';
    const dialCode = this.countryDialCodeMap[country] || '';

    const currencyRecord = await this.prisma.currency.upsert({
      where: { code: currencyCode },
      update: {},
      create: {
        code: currencyCode,
        name: currencyCode,
        symbol: currencyCode,
        decimals: ['BTC', 'ETH', 'USDT'].includes(currencyCode) ? 8 : 2,
        isCrypto: ['BTC', 'ETH', 'USDT'].includes(currencyCode),
      },
    });

    const countryRecord = await this.prisma.country.upsert({
      where: { iso2: country },
      update: { name: country, dialCode, isActive: true, currencyId: currencyRecord.id },
      create: {
        iso2: country,
        name: country,
        dialCode,
        currency: {
          connect: { id: currencyRecord.id },
        },
      },
    });

    const methodRecord = await this.prisma.paymentMethodRef.upsert({
      where: { code: method },
      update: { isActive: true },
      create: { code: method, name: method },
    });

    await this.prisma.paymentProvider.upsert({
      where: { providerCode: providerData.id },
      update: {
        name: providerData.name,
        countryId: countryRecord.id,
        methodId: methodRecord.id,
        requiresType: !!providerData.methodType,
        isActive: true,
      },
      create: {
        providerCode: providerData.id,
        name: providerData.name,
        countryId: countryRecord.id,
        methodId: methodRecord.id,
        requiresType: !!providerData.methodType,
      },
    });

    this.supportedMap[country] = this.supportedMap[country] || new Set();
    this.supportedMap[country].add(method);
    this.countryCurrencyMap[country] = currencyCode;
    if (dialCode) this.countryDialCodeMap[country] = dialCode;
  }

  private async getCurrencyForCountry(country: NetwalletpayCountry): Promise<string> {
    // Check memory cache first
    const mapped = this.countryCurrencyMap[country];
    if (mapped) {
      return mapped;
    }

    // Fall back to DB query if not in cache
    try {
      const countryData = await this.prisma.country.findUnique({
        where: { iso2: country },
        include: { currency: true },
      });
      if (countryData?.currency?.code) {
        this.countryCurrencyMap[country] = countryData.currency.code;
        return countryData.currency.code;
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch currency for ${country}:`, error);
    }

    return 'USD';
  }

  private async getCountryDialCode(country: NetwalletpayCountry): Promise<string> {
    // Check memory cache first
    const mapped = this.countryDialCodeMap[country];
    if (mapped) {
      return mapped;
    }

    // Fall back to DB query if not in cache
    try {
      const countryData = await this.prisma.country.findUnique({
        where: { iso2: country },
      });
      if (countryData?.dialCode) {
        this.countryDialCodeMap[country] = countryData.dialCode;
        return countryData.dialCode;
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch dial code for ${country}:`, error);
    }

    return '';
  }

  /**
   * Format phone number for Netwalletpay API.
   * Result: plain digits with country code prefix, no + sign. e.g. "237670000000"
   *
   * Strategy: always extract the pure local part first, then recompose.
   * This prevents any double-country-code issue regardless of how the frontend
   * composed the number.
   */
  private async formatPhoneNumber(phone: string, country: NetwalletpayCountry): Promise<string> {
    if (!phone) return phone;

    const dialCode     = await this.getCountryDialCode(country);
    const cc           = dialCode.replace('+', ''); // e.g. "237"

    // 1. Strip all formatting characters (keep digits only)
    let digits = phone.replace(/[\s+\-\(\)]/g, '');

    // 2. Strip international dialling prefix 00 → remaining starts with country code
    if (digits.startsWith('00')) {
      digits = digits.substring(2);
    }

    // 3. Strip country code prefix → leaves pure local digits
    if (digits.startsWith(cc)) {
      digits = digits.substring(cc.length);
    }

    // 4. Strip any spurious leading zero (local-format habit)
    if (digits.startsWith('0')) {
      digits = digits.substring(1);
    }

    // 5. Recompose: countryCode + localDigits  (API expects no + sign)
    const formatted = cc + digits;

    this.logger.log(
      `📱 Phone formatting: ${phone} → ${formatted}` +
      `  [cc=${cc} local=${digits} country=${country}]`,
    );
    return formatted;
  }

  /**
   * Map MethodType for each country-method combination (API spec requirement)
   */
  private getMethodType(country: NetwalletpayCountry, method: NetwalletpayMethod, providerId?: string): string {
    // MethodType is only required for MOBILE_MONEY method in Cameroon
    if (method !== 'MOBILE_MONEY' || country !== 'CM') {
      return '';
    }

    // For Cameroon mobile money, MethodType depends on the provider network
    const normalizedProvider = providerId?.toLowerCase() || '';

    if (normalizedProvider.includes('mtn')) {
      return 'MOMO';
    } else if (normalizedProvider.includes('orange')) {
      return 'ORANGE_MONEY';
    } else if (normalizedProvider.includes('eu')) {
      return 'EU';
    }

    return 'MOMO'; // Default fallback
  }

  private getMethodProviderCandidates(currentProvider: string): string[] {
    const normalized = currentProvider?.toLowerCase?.() || '';
    const candidates = [currentProvider];

    // Valid provider codes from database seed / Netwalletpay API
    // Only try alternative codes, NOT provider names (names are not valid API values)
    if (normalized === 'mtn_cm' || normalized === 'mtn') {
      return [...new Set([...candidates, 'mtn_cm', 'mtn'])];
    }
    if (normalized === 'orange_cm' || normalized === 'orange') {
      return [...new Set([...candidates, 'orange_cm', 'orange'])];
    }
    if (normalized === 'eu_cm' || normalized === 'eu') {
      return [...new Set([...candidates, 'eu_cm', 'eu'])];
    }
    if (normalized === 'netwallet_cm' || normalized === 'netwallet') {
      return [...new Set([...candidates, 'netwallet_cm', 'netwallet'])];
    }

    // For other providers, return the code as-is
    return candidates;
  }

  private isRetryableError(error: unknown): boolean {
    const message = (error as Error)?.message?.toLowerCase?.() || '';
    return message.includes('500') ||
           message.includes('internal server') ||
           message.includes('4008') ||
           message.includes('unsubscribe') ||
           message.includes('method type');
  }

  private async postWithMethodProviderFallback(endpoint: string, basePayload: any): Promise<any> {
    const providerCandidates = this.getMethodProviderCandidates(basePayload.MethodProvider);
    let lastError: Error | null = null;
    const requireSecret = endpoint.includes('/payout/');

    for (const providerCandidate of providerCandidates) {
      const methodTypeCandidates = (basePayload.Method === 'MOBILE_MONEY' && basePayload.CountryCode === 'CM')
        ? this.getMethodTypeCandidates(providerCandidate)
        : [''];

      for (const methodTypeCandidate of methodTypeCandidates) {
        const payload = {
          ...basePayload,
          MethodProvider: providerCandidate,
          MethodType: methodTypeCandidate || undefined,
        };

        if (!payload.MethodType) {
          delete payload.MethodType;
        }

        try {
          return await this.makeApiRequest('POST', endpoint, payload, requireSecret);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));

          const isFinalProvider = providerCandidate === providerCandidates[providerCandidates.length - 1];
          const isFinalMethodType = methodTypeCandidate === methodTypeCandidates[methodTypeCandidates.length - 1];

          if (!this.isRetryableError(lastError) || (isFinalProvider && isFinalMethodType)) {
            throw lastError;
          }

          this.logger.warn(`MethodProvider ${providerCandidate} + MethodType ${methodTypeCandidate || '<none>'} failed, trying next candidate`, {
            error: lastError.message,
            endpoint,
            payload,
          });
        }
      }
    }

    throw lastError || new Error('Unknown fallback error');
  }

  /**
   * Map our internal methods to netwalletpay methods
   */
  private mapMethod(method: string): NetwalletpayMethod {
    const normalized = method?.toUpperCase();

    switch (normalized) {
      case 'MOMO':
      case 'ORANGE':
        return 'MOBILE_MONEY';
      case 'CARD':
        return 'CARD';
      case 'BANK':
        return 'BANK';
      case 'NETWALLET_PAY':
        return 'NETWALLET_PAY';
      case 'LIGHTNING':
      case 'BTC':
      case 'CRYPTO':
        return 'CRYPTO';
      default:
        return 'MOBILE_MONEY'; // Default fallback
    }
  }

  /**
   * Check if country + method combination is supported
   */
  isSupported(country: string, method: string): boolean {
    const countryCode = country.toUpperCase() as NetwalletpayCountry;
    const netwalletpayMethod = this.mapMethod(method);

    // Use the supportedMap populated from DB during init
    if (this.supportedMap[countryCode]) {
      return this.supportedMap[countryCode].has(netwalletpayMethod);
    }

    // If not in cache, it's not in the database either
    this.logger.warn(`Country ${countryCode} not found in supported map`);
    return false;
  }

  /**
   * Get supported currencies for a country (from database cache populated on init)
   */
  getSupportedCurrencies(country: string): string[] {
    const countryCode = country.toUpperCase() as NetwalletpayCountry;
    const currency = this.countryCurrencyMap[countryCode];
    return currency ? [currency] : [];
  }

  /**
   * Get valid access token (fetch from API and cache for 15 minutes)
   */
  private async getAccessToken(): Promise<string> {
    const now = new Date();

    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && now < this.tokenExpiry) {
      this.logger.log('♻️ Using cached access token');
      return this.accessToken;
    }

    this.logger.log('🔐 Fetching new access token from API...');
    this.logger.log('📋 Token Request Credentials:', {
      email: this.config.email,
      primaryKeyPrefix: this.config.primaryKey?.substring(0, 10) + '...',
      primaryKeyLength: this.config.primaryKey?.length,
      grantType: 'primary_key',
    });

    try {
      // Prepare form-urlencoded body
      const formData = new URLSearchParams();
      formData.append('primary_key', this.config.primaryKey);
      formData.append('email', this.config.email);
      formData.append('grant_type', 'primary_key');

      this.logger.log('📤 Token Request Body:', formData.toString());

      const response = await fetch(`${this.config.baseUrl}/api/v1/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`❌ Failed to get access token: ${response.status}`, {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          email: this.config.email,
          primaryKeyPrefix: this.config.primaryKey?.substring(0, 10) + '...',
        });
        throw new Error(`Token fetch failed: ${response.status} - ${errorText}`);
      }

      const data: AccessTokenResponse = await response.json();
      this.logger.log('✅ Access token obtained', {
        expiresIn: data.expires_in,
        tokenLength: data.access_token.length,
      });

      // Cache token for expires_in seconds minus 30 second buffer
      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(now.getTime() + (data.expires_in - 30) * 1000);

      return this.accessToken;
    } catch (error) {
      this.logger.error('🔗 Error fetching access token:', error);
      throw error;
    }
  }

  /**
   * Make authenticated API request with Bearer token
   */
  private async makeApiRequest(
    method: 'GET' | 'POST',
    endpoint: string,
    data?: any,
    requireSecret: boolean = false
  ): Promise<any> {
    const token = await this.getAccessToken();
    const url = `${this.config.baseUrl}${endpoint}`;

    // Use Bearer token format as per API spec
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // Add secret key for payout requests if needed
    if (requireSecret && this.config.secondaryKey) {
      headers['X-Secret-Key'] = this.config.secondaryKey;
    }

    const requestOptions: RequestInit = {
      method,
      headers,
    };

    if (data && method === 'POST') {
      requestOptions.body = JSON.stringify(data);
    }

    this.logger.log(`📡 Netwalletpay API ${method} ${url}`, {
      endpoint,
      hasData: !!data,
      requiresSecret: requireSecret,
    });

    if (data) {
      this.logger.log(`   Request payload:`, data);
    }

    try {
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const errorData = await response.text();
        let parsedError;
        try {
          parsedError = JSON.parse(errorData);
        } catch {
          parsedError = { message: errorData };
        }

        this.logger.error(`❌ API Error ${response.status}:`, {
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type'),
          errorCode: parsedError.errorCode || parsedError.code,
          errorMessage: parsedError.message,
          fullBody: errorData.substring(0, 1000),
          url,
          method,
          requestPayload: data,
        });

        throw new Error(`API request failed: ${response.status} - ${parsedError.message || errorData}`);
      }

      const responseData = await response.json();
      this.logger.log(`✅ API Response:`, {
        statusCode: responseData.statusCode,
        dataLength: JSON.stringify(responseData.data).length,
        hasMessage: !!responseData.message,
      });

      return responseData;
    } catch (error) {
      this.logger.error(`🔗 Fetch error:`, {
        message: (error as Error).message,
        endpoint,
        method,
      });
      throw error;
    }
  }
}
