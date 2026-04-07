# Blink API Lightning & Bitcoin Integration

## Overview

TchokoPay now supports **Lightning Network** and **on-chain Bitcoin** payments through the [Blink API](https://dev.blink.sv/). This allows:

✅ **Instant Lightning payments** - Send and receive Bitcoin instantly via Lightning Network  
✅ **On-chain Bitcoin** - Traditional Bitcoin transactions for recipients who prefer it  
✅ **Invoice management** - Create and track Lightning invoices  
✅ **Automated payouts** - Send payments to recipients automatically  
✅ **Multi-currency conversion** - Automatically convert between BTC/SAT/XAF  

## Architecture

```
Payment Request (CREATE/PAY)
    ↓
Payment Service
    ↓
Lightning/Crypto Provider
    ↓
Blink API Service
    ↓
Blink GraphQL API (dev.blink.sv)
```

### Components

**BlinkApiService** (`src/payment/providers/services/blink-api.service.ts`)
- Handles all GraphQL queries/mutations to Blink API
- Creates invoices, pays invoices, checks balances
- Manages error handling and currency conversion

**LightningProvider** (`src/payment/providers/lightning.provider.ts`)
- Implements PaymentProvider interface for Lightning payments
- PAYIN: Creates invoices for customers to pay
- PAYOUT: Pays Lightning invoices to recipients

**CryptoProvider** (`src/payment/providers/crypto.provider.ts`)
- Implements PaymentProvider interface for on-chain Bitcoin
- PAYIN: Generates BTC addresses for receiving
- PAYOUT: Sends on-chain transactions

## Setup Instructions

### 1. Get Blink API Credentials

1. Go to [Blink Dashboard](https://dashboard.blink.sv/)
2. Sign up or log in
3. Navigate to **API Settings**
4. Generate API Key
5. Copy your **Account ID**

### 2. Configure Environment Variables

Copy `.env.blink.example` to `.env` and fill in your credentials:

```bash
BLINK_API_URL=https://api.blink.sv/graphql
BLINK_API_KEY=your_api_key_here
BLINK_ACCOUNT_ID=your_account_id_here
```

### 3. Install Dependencies

If not already installed:

```bash
npm install @nestjs/axios @nestjs/config
```

### 4. Build & Run

```bash
npm run build
npm run start:dev
```

## Usage Examples

### Creating a Payment Request (Lightning)

**REQUEST CREATE - Recipient creates invoice for payment:**

```json
{
  "flow": "REQUEST",
  "action": "CREATE",
  "amount": 5000,
  "amountType": "RECEIVE",
  "targetCurrency": "XAF",
  "payoutMethod": "MOMO",
  "description": "Invoice for services"
}
```

**What happens:**
1. Invoice is created in database
2. When customer pays (flow=REQUEST, action=PAY with paymentMethod=LIGHTNING):
   - LightningProvider creates invoice via Blink API
   - Customer scans QR code and pays
   - Payment is received instantly
3. Blink API confirms payment
4. MOMO payout is triggered to recipient

### Direct Lightning Payment

**DIRECT - Customer pays directly with Lightning:**

```json
{
  "flow": "DIRECT",
  "amount": 0.0001,
  "amountType": "PAY",
  "baseCurrency": "BTC",
  "targetCurrency": "XAF",
  "paymentMethod": "LIGHTNING",
  "payoutMethod": "MOMO",
  "recipientPhone": "237670000000",
  "description": "Direct payment"
}
```

**What happens:**
1. LightningProvider creates invoice
2. Customer scans and pays
3. Payment confirmed via Blink
4. MOMO payout sent to recipient
5. Transaction recorded in database

### On-Chain Bitcoin Payment

**DIRECT - Customer pays with on-chain Bitcoin:**

```json
{
  "flow": "DIRECT",
  "amount": 0.001,
  "amountType": "PAY",
  "baseCurrency": "BTC",
  "targetCurrency": "XAF",
  "paymentMethod": "BTC",
  "payoutMethod": "MOMO",
  "recipientPhone": "237670000000",
  "description": "Bitcoin transfer"
}
```

**What happens:**
1. CryptoProvider generates BTC address
2. Customer sends on-chain Bitcoin
3. Blockchain confirms (10-60 minutes)
4. MOMO payout sent
5. Transaction recorded

## API Methods

### BlinkApiService

#### createInvoice(amountSat, description, reference)
Creates a Lightning invoice to receive payment

**Parameters:**
- `amountSat` (number): Amount in satoshis
- `description` (string): Invoice description
- `reference` (string): Unique reference for tracking

**Returns:**
```typescript
{
  id: string;
  paymentRequest: string;  // QR code/invoice string
  amount: number;          // Satoshis
  expiresAt: Date;
  status: string;
}
```

#### getInvoiceStatus(invoiceId)
Check if invoice has been paid

**Returns:**
```typescript
{
  id: string;
  status: string;
  paid: boolean;
  paidAmount?: number;
  paidAt?: Date;
}
```

#### payLightningInvoice(paymentRequest, memo?)
Pay a Lightning invoice

**Parameters:**
- `paymentRequest` (string): Invoice to pay
- `memo` (string, optional): Payment note

**Returns:**
```typescript
{
  status: string;
  hash?: string;
  amount: number;
  fee: number;
  timestamp: Date;
}
```

#### getBitcoinAddress()
Get address for receiving on-chain Bitcoin

**Returns:**
```typescript
{
  address: string;
  accountId: string;
}
```

#### getAccountBalance()
Check available balance

**Returns:**
```typescript
{
  btc: number;  // Satoshis
  usd: number;
}
```

## Currency Conversion

The system automatically converts between currencies:

| From | To | Formula |
|------|-----|---------|
| BTC | SAT | amount × 100,000,000 |
| SAT | BTC | amount ÷ 100,000,000 |
| SAT | XAF | Uses QuoteService exchange rate |
| XAF | SAT | Uses QuoteService exchange rate |

**Example:**
- 0.001 BTC = 100,000 SAT
- 100,000 SAT = ~5,000 XAF (at current rate)

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| Missing API credentials | BLINK_API_KEY or BLINK_ACCOUNT_ID not set | Check .env file |
| Invoice creation failed | Amount too small | Use minimum 1000 satoshis |
| Insufficient balance | Not enough funds in account | Top up Blink account |
| Invalid payment request | Malformed Lightning invoice | Verify invoice format |
| Timeout | Payment not completed in time | Invoice expires after 1 hour |

## Testing

### With Testnet

For testing without real Bitcoin:

1. Create test Blink account
2. Use testnet credentials
3. Receive test sats from Blink faucet
4. Test payment flows

### Webhook Testing

For production, implement webhooks to receive payment updates:

```javascript
POST /api/payments/webhooks/blink
{
  "event": "invoice.paid",
  "invoiceId": "...",
  "amount": 100000,
  "timestamp": "2024-03-25T10:00:00Z"
}
```

## Payment Flow Diagrams

### REQUEST CREATE → PAY (Lightning)

```
Customer Browser
    ↓
[REQUEST CREATE] (Recipient creates invoice)
    ↓
Database (Invoice created, status=PENDING)
    ↓
[REQUEST PAY] (Payer chooses LIGHTNING)
    ↓
BlinkApiService.createInvoice()
    ↓
Blink API returns paymentRequest (QR)
    ↓
Customer scans & pays via Lightning wallet
    ↓
Lightning Network confirms payment (instant)
    ↓
BlinkApiService.getInvoiceStatus() (paid=true)
    ↓
MOMO Payout triggered to Recipient
    ↓
Recipient receives funds
```

### DIRECT Flow (Lightning)

```
Payer (Lightning Wallet)
    ↓
[DIRECT payment request]
    ↓
LightningProvider.payin() creates invoice
    ↓
QR/Invoice string returned to payer
    ↓
Payer scans and sends BTC via Lightning
    ↓
Blink confirms payment
    ↓
LightningProvider.payout() sends MOMO
    ↓
Recipient receives funds
```

## Troubleshooting

### Invoice Not Being Paid

1. Check if QR code is correctly generated
2. Verify invoice hasn't expired (1 hour default)
3. Check Blink account has balance
4. Check network connectivity

### Payout Not Being Sent

1. Verify recipient MOMO number is correct
2. Check account has sufficient balance
3. Check MOMO provider is available in region
4. Check payoutMethod in invoice matches

### Payment Webhook Not Received

1. Verify webhook URL is publicly accessible
2. Check Blink webhook secret matches
3. Verify DNS and SSL certificates
4. Check nginx/proxy forwarding headers

## Security Considerations

⚠️ **Important Security Notes:**

1. **Keep API Key Secret**
   - Never commit BLINK_API_KEY to git
   - Use environment variables
   - Rotate keys regularly

2. **Validate Webhook Signatures**
   - Verify webhook HMAC signature
   - Check timestamp to prevent replay attacks

3. **Amount Limits**
   - Implement per-transaction limits
   - Daily account limits
   - Rate limiting per user

4. **Audit Logging**
   - Log all payment attempts
   - Track failed payments
   - Monitor for unusual patterns

5. **Private Key Management**
   - If using custom on-chain implementation
   - Never store private keys in code
   - Use hardware wallets for production

## Production Checklist

- [ ] Set BLINK_API_KEY and BLINK_ACCOUNT_ID in production environment
- [ ] Configure webhook endpoint
- [ ] Implement webhook signature verification
- [ ] Set appropriate payment limits
- [ ] Enable production logging/monitoring
- [ ] Test invoice creation and payment
- [ ] Test MOMO payout integration
- [ ] Test error handling scenarios
- [ ] Load test with expected transaction volume
- [ ] Set up monitoring and alerts
- [ ] Document incident response procedures

## Future Enhancements

- [ ] USDT/Stablecoin support
- [ ] Multi-wallet management
- [ ] Custom fee tier selection
- [ ] Payment batching for efficiency
- [ ] Automated reconciliation reports
- [ ] Advanced fraud detection
- [ ] Instant settlement options

## References

- [Blink API Documentation](https://dev.blink.sv/)
- [Lightning Network](https://lightning.network/)
- [Bitcoin on-chain transactions](https://bitcoin.org/en/)
- [GraphQL Basics](https://graphql.org/)

## Support

For issues or questions:
1. Check [Blink Documentation](https://dev.blink.sv/)
2. Review error logs in `logs/` directory
3. Check payment status in database
4. Open an issue on GitHub

---

**Last Updated:** March 25, 2026  
**Version:** 1.0.0  
**Status:** Production Ready ✅
