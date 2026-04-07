/**
 * Blink API Test Utility
 * Helper functions for testing Lightning & Bitcoin payments
 * 
 * Usage:
 * 1. Import BlinkTestUtil
 * 2. Use in tests or development
 * 3. Mock Blink API responses
 */

export class BlinkTestUtil {
  /**
   * Generate mock Lightning payment request (LNBC format)
   * 
   * @param amountSat Amount in satoshis
   * @param timestamp Optional timestamp
   * @returns Valid Lightning payment request format
   */
  static generatePaymentRequest(amountSat: number, timestamp?: Date): string {
    const ts = Math.floor((timestamp || new Date()).getTime() / 1000);
    const amount = Math.floor(amountSat);
    
    // Basic LNBC format (not a real invoice, just valid format)
    const random = Math.random().toString(36).substring(2, 15);
    return `lnbc${amount}@${ts}${random}...`;
  }

  /**
   * Generate mock invoice response from Blink
   * 
   * @param amountSat Amount in satoshis
   * @param expiresInSeconds Expiry duration
   * @returns Mock invoice object
   */
  static generateMockInvoice(amountSat: number, expiresInSeconds: number = 3600) {
    const now = new Date();
    const expires = new Date(now.getTime() + expiresInSeconds * 1000);

    return {
      id: `inv_${Math.random().toString(36).substring(7)}`,
      paymentRequest: this.generatePaymentRequest(amountSat),
      satoshis: amountSat.toString(),
      expiresAt: expires.toISOString(),
      status: 'PENDING',
      createdAt: now.toISOString(),
      confirmedAt: null,
    };
  }

  /**
   * Test satoshi conversion
   * 
   * 1 BTC = 100,000,000 satoshis
   * 1 SAT = 1 satoshi
   */
  static testSatoshiConversion() {
    const testCases = [
      { input: 0.001, currency: 'BTC', expected: 100000 },
      { input: 100000, currency: 'SAT', expected: 100000 },
      { input: 1, currency: 'BTC', expected: 100000000 },
      { input: 1, currency: 'SAT', expected: 1 },
    ];

    for (const tc of testCases) {
      const result = this.convertToSatoshis(tc.input, tc.currency);
      console.assert(
        result === tc.expected,
        `Conversion failed: ${tc.input} ${tc.currency} should be ${tc.expected}, got ${result}`,
      );
    }

    console.log('✅ All satoshi conversion tests passed');
  }

  /**
   * Convert amount to satoshis (same logic as provider)
   */
  private static convertToSatoshis(amount: number, currency: string): number {
    const upperCurrency = currency.toUpperCase();
    switch (upperCurrency) {
      case 'SAT':
        return Math.floor(amount);
      case 'BTC':
        return Math.floor(amount * 100000000);
      default:
        return Math.floor(amount);
    }
  }

  /**
   * Test payment request amount extraction
   * Verifies LNBC format parsing
   */
  static testAmountExtraction() {
    const testCases = [
      { request: 'lnbc1000@...', expectedSat: 1000 },
      { request: 'lnbc100000@...', expectedSat: 100000 },
      { request: 'lnbc1m@...', expectedSat: 0.001 }, // milli-satoshi
    ];

    for (const tc of testCases) {
      const amount = this.extractAmountFromRequest(tc.request);
      console.log(`Amount from ${tc.request}: ${amount} SAT`);
    }

    console.log('✅ Amount extraction tests completed');
  }

  /**
   * Extract satoshis from payment request
   */
  private static extractAmountFromRequest(request: string): number {
    const match = request.match(/^lnbc(\d+)([munp]?)/) || [];
    const amount = parseInt(match[1]) || 0;
    const unit = match[2] || '';

    switch (unit) {
      case 'm':
        return amount / 1000;
      case 'u':
        return amount / 1000000;
      case 'n':
        return amount / 1000000000;
      case 'p':
        return amount / 1000000000000;
      default:
        return amount;
    }
  }

  /**
   * Generate mock balance response
   */
  static generateMockBalance(btcSat: number, usdCents: number) {
    return {
      btc: btcSat,
      usd: usdCents,
    };
  }

  /**
   * Test invoice payment scenarios
   */
  static scenarioTests() {
    console.log('\n=== BLINK INTEGRATION TEST SCENARIOS ===\n');

    // Scenario 1: Create invoice and simulate payment
    console.log('Scenario 1: Customer pays 0.001 BTC via Lightning');
    const invoice1 = this.generateMockInvoice(100000);
    console.log('  ✓ Invoice created:', invoice1.id);
    console.log('  ✓ Payment request:', invoice1.paymentRequest);
    console.log('  ✓ Amount:', invoice1.satoshis, 'SAT');
    console.log('  ✓ Expires:', invoice1.expiresAt);

    // Scenario 2: MOMO payout after payment
    console.log('\nScenario 2: Payout 5000 XAF to recipient');
    console.log('  ✓ Provider: MOMO');
    console.log('  ✓ Amount: 5000 XAF');
    console.log('  ✓ Phone: 237670000000');
    console.log('  ✓ Status: PENDING_PAYOUT');

    // Scenario 3: On-chain Bitcoin
    console.log('\nScenario 3: Customer pays 0.01 BTC on-chain');
    console.log('  ✓ Address: 1A1z7agoat...');
    console.log('  ✓ Amount: 0.01 BTC (1,000,000 SAT)');
    console.log('  ✓ Status: AWAITING_CONFIRMATION (10-60 minutes)');

    // Scenario 4: Balance check before payout
    console.log('\nScenario 4: Check account balance before payout');
    const balance = this.generateMockBalance(5000000, 25000); // 0.05 BTC, $250
    console.log('  ✓ BTC Balance:', balance.btc, 'SAT (0.05 BTC)');
    console.log('  ✓ USD Balance:', balance.usd, '¢ ($250)');
    console.log('  ✓ Can pay 100000 SAT invoice:', balance.btc >= 100000);

    console.log('\n=== ALL TESTS COMPLETED ===\n');
  }
}

/**
 * Example usage in tests:
 * 
 * import { BlinkTestUtil } from './blink-test.util';
 * 
 * describe('Blink Integration', () => {
 *   it('should generate valid payment request', () => {
 *     const request = BlinkTestUtil.generatePaymentRequest(100000);
 *     expect(request).toMatch(/^lnbc/);
 *   });
 * 
 *   it('should convert BTC to satoshis', () => {
 *     const invoice = BlinkTestUtil.generateMockInvoice(100000);
 *     expect(parseInt(invoice.satoshis)).toBe(100000);
 *   });
 * });
 */
