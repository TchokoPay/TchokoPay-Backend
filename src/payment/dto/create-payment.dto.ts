import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  Min,
  ValidateIf,
} from 'class-validator';

import { FlowType, PaymentAction, CurrencyCode, AmountType } from '../enums/payment.enums.js';

export class CreatePaymentDto {
  // ============================
  // FLOW
  // ============================
  @ApiProperty({
    example: 'DIRECT',
    enum: FlowType,
    description: `Payment flow type: DIRECT | QR | REQUEST

**DIRECT Flow - Pay to phone number (Registered or Guest):**
- Payer pays directly to recipient phone
- Examples:
  * LIGHTNING to MOMO (registered user):
    {
      "flow": "DIRECT",
      "amount": 0.0001,
      "amountType": "PAY",
      "baseCurrency": "BTC",
      "targetCurrency": "XAF",
      "paymentMethod": "LIGHTNING",
      "payoutMethod": "MOMO",
      "recipientPhone": "670654321",
      "description": "Payment for services"
    }
  * MOMO to MOMO (guest user, requires payerPhone):
    {
      "flow": "DIRECT",
      "amount": 5000,
      "amountType": "PAY",
      "baseCurrency": "XAF",
      "targetCurrency": "XAF",
      "paymentMethod": "MOMO",
      "payoutMethod": "MOMO",
      "recipientPhone": "670000000",
      "payerPhone": "670111111",
      "description": "Direct mobile money transfer"
    }

**QR Flow - Pay to recipient handle (Registered user):**
- Payer pays to recipient's registered handle (@username)
- ⚠️ NOTE: All QR payments currently use MOMO payout only (payoutMethod is ignored, will be upgraded soon for BANK/CRYPTO support)
- Recipient receives payment via their verified MOMO phone number
- Examples:
  * LIGHTNING to MOMO (registered QR user):
    {
      "flow": "QR",
      "amount": 0.0001,
      "amountType": "PAY",
      "baseCurrency": "BTC",
      "targetCurrency": "XAF",
      "paymentMethod": "LIGHTNING",
      "recipientHandle": "@tchoko-brian",
      "description": "QR code payment - recipient gets MOMO"
    }
  * MOMO to MOMO (guest payer with phone, payout forced to recipient's MOMO):
    {
      "flow": "QR",
      "amount": 2500,
      "amountType": "PAY",
      "baseCurrency": "XAF",
      "targetCurrency": "XAF",
      "paymentMethod": "MOMO",
      "recipientHandle": "@tchoko-alice",
      "payerPhone": "670222222",
      "description": "QR mobile money payment - recipient gets MOMO"
    }

**REQUEST CREATE - Create payment request (Registered or Guest):**
- Recipient creates invoice for payer to pay later
- Creates an invoice with amount to RECEIVE (payer will PAY to settle it)
- For now: MOMO payout only
- Registered user: auto-uses verified phone, no payerPhone needed
- Guest user: MUST provide payerPhone (your MOMO number to receive funds)
- ❌ DO NOT include paymentMethod in REQUEST CREATE (payer chooses paymentMethod when paying)
- Examples:
  * Registered user (auto-uses verified MOMO):
    {
      "flow": "REQUEST",
      "action": "CREATE",
      "amount": 5000,
      "amountType": "RECEIVE",
      "targetCurrency": "XAF",
      "payoutMethod": "MOMO",
      "description": "Invoice for shoes - valid for 24 hours"
    }
  * Guest user (MUST provide payerPhone to receive funds):
    {
      "flow": "REQUEST",
      "action": "CREATE",
      "amount": 5000,
      "amountType": "RECEIVE",
      "targetCurrency": "XAF",
      "payoutMethod": "MOMO",
      "payerPhone": "674567325",
      "description": "Request payment - payer chooses payment method when settling"
    }

**REQUEST PAY - Pay existing request (Registered or Guest Payer):**
- Payer pays an existing invoice using the reference
- Payer specifies: baseCurrency (what they pay in) + paymentMethod (how they pay)
- ❌ DO NOT include payoutMethod (payout method is locked in the invoice from when it was created)
- Registered user with LIGHTNING/BTC: no phone needed
- Registered user with MOMO: no phone needed (auto-resolved from verified contact)
- Guest user with MOMO: MUST provide payerPhone (their MOMO number to send from)
- Examples:
  * Registered user paying with LIGHTNING:
    {
      "flow": "REQUEST",
      "action": "PAY",
      "invoiceReference": "REQ-1774408197902",
      "baseCurrency": "SAT",
      "paymentMethod": "LIGHTNING",
      "description": "Paying invoice"
    }
  * Registered user paying with MOMO (no phone needed):
    {
      "flow": "REQUEST",
      "action": "PAY",
      "invoiceReference": "REQ-1774408197902",
      "baseCurrency": "XAF",
      "paymentMethod": "MOMO",
      "description": "Paying invoice via registered MOMO"
    }
  * Guest user paying with MOMO (MUST provide payerPhone):
    {
      "flow": "REQUEST",
      "action": "PAY",
      "invoiceReference": "REQ-1774408197902",
      "baseCurrency": "XAF",
      "paymentMethod": "MOMO",
      "payerPhone": "670333333",
      "description": "Paying invoice as guest via MOMO"
    }
    `,
  })
  @IsEnum(FlowType)
  flow!: FlowType;

  // ============================
  // ACTION (ONLY FOR REQUEST FLOW)
  // ============================
  @ApiPropertyOptional({
    example: 'CREATE',
    enum: PaymentAction,
    description: `Action for REQUEST flow:

- **CREATE**: Recipient creates invoice (payer will pay later)
  * **Registered user**: Auto-uses verified phone for MOMO payout
    - ONLY provide: amount, amountType (RECEIVE), targetCurrency, payoutMethod (MOMO), description
    - ❌ DO NOT include paymentMethod (payer decides how to pay when settling invoice)
    - Example: { "flow": "REQUEST", "action": "CREATE", "amount": 5000, "amountType": "RECEIVE", "targetCurrency": "XAF", "payoutMethod": "MOMO" }
  
  * **Guest user**: MUST provide payerPhone (your MOMO number to receive payment)
    - ONLY provide: amount, amountType (RECEIVE), targetCurrency, payoutMethod (MOMO), payerPhone, description
    - ❌ DO NOT include paymentMethod
    - Example: { "flow": "REQUEST", "action": "CREATE", "amount": 5000, "amountType": "RECEIVE", "targetCurrency": "XAF", "payoutMethod": "MOMO", "payerPhone": "674567325" }

- **PAY**: Payer pays existing invoice by reference
  * **Registered user**: Auto-resolves MOMO phone if verified
    - ONLY provide: invoiceReference, baseCurrency, paymentMethod (LIGHTNING/MOMO), description
    - ❌ DO NOT include payoutMethod (payout method is locked in the invoice)
    - Example: { "flow": "REQUEST", "action": "PAY", "invoiceReference": "REQ-123", "baseCurrency": "XAF", "paymentMethod": "MOMO" }
  
  * **Guest user**: MUST provide payerPhone if paying via MOMO
    - ONLY provide: invoiceReference, baseCurrency, paymentMethod, payerPhone, description
    - Example: { "flow": "REQUEST", "action": "PAY", "invoiceReference": "REQ-123", "baseCurrency": "XAF", "paymentMethod": "MOMO", "payerPhone": "670333333" }

Required only when: flow = REQUEST
    `,
  })
  @ValidateIf((o) => o.flow === FlowType.REQUEST)
  @IsEnum(PaymentAction)
  action?: PaymentAction;

  // ============================
  // AMOUNT
  // ============================
  @ApiPropertyOptional({
    example: 5000,
    description: `Payment amount in base/source currency.

Required for: DIRECT, QR, REQUEST CREATE
NOT required for: REQUEST PAY (amount comes from invoice)

Examples by flow & method:
- DIRECT LIGHTNING: 0.0001 (BTC)
- DIRECT MOMO: 5000 (XAF cents)
- QR LIGHTNING: 0.0001 (BTC)
- QR MOMO: 2500 (XAF cents)
- REQUEST CREATE: 50000 (XAF cents, invoice amount to RECEIVE)
- REQUEST PAY: omitted (invoice has amount)

Minimum: 0.00000001 (satoshi for crypto, 1 unit for fiat)
    `
  })
  @ValidateIf((o) => o.flow !== FlowType.REQUEST || o.action === PaymentAction.CREATE)
  @IsNotEmpty()
  @IsNumber()
  @Min(0.00000001)
  amount?: number;

  // ============================
  // AMOUNT TYPE
  // ============================
  @ApiPropertyOptional({
    example: 'PAY',
    enum: AmountType,
    description: `Specifies what 'amount' represents:
- PAY: You pay this amount; system calculates what recipient gets (default)
- RECEIVE: Recipient receives this amount; system calculates what you pay

Required for: REQUEST CREATE
Optional for: DIRECT, QR (defaults to PAY if not specified)

Examples:
- LIGHTNING to MOMO (PAY): 0.0001 BTC → system calculates XAF received
- MOMO to MOMO (RECEIVE): specify 5000 XAF received → system calculates MOMO fee required
- REQUEST CREATE (RECEIVE): 50000 XAF → invoice amount payer must pay
    `
  })
  @ValidateIf((o) => o.flow !== FlowType.REQUEST || o.action === PaymentAction.CREATE)
  @IsEnum(AmountType)
  amountType?: AmountType;

  // ============================
  // CURRENCIES
  // ============================
  @ApiPropertyOptional({
    example: 'BTC',
    enum: CurrencyCode,
    description: `Base currency (what you pay in). Supported: BTC, SAT, XAF, USDT

Required ONLY when: flow = REQUEST AND action = PAY
Optional for: DIRECT, QR (defaults to payer's wallet currency if not specified)

- BTC: Full Bitcoin (1 BTC = 100,000,000 SAT)
- SAT: Satoshi (1/100,000,000 BTC) - use for small LIGHTNING payments
- XAF: Central African Franc (fiat)
- USDT: Tether USD

Examples:
- REQUEST PAY with LIGHTNING: baseCurrency = "SAT" or "BTC"
- DIRECT MOMO: no baseCurrency needed if logged-in user
- QR LIGHTNING: baseCurrency implied from user's BTC/SAT wallet
    `,
  })
  @ValidateIf((o) => o.flow === FlowType.REQUEST && o.action === PaymentAction.PAY)
  @IsNotEmpty()
  @IsEnum(CurrencyCode)
  baseCurrency?: CurrencyCode;

  @ApiPropertyOptional({
    example: 'XAF',
    enum: CurrencyCode,
    description: `Target currency (what recipient receives). Supported: BTC, SAT, XAF, USDT

Required for: DIRECT, QR, REQUEST CREATE
Optional for: REQUEST PAY (target currency in invoice)

- XAF: Central African Franc via fiat methods (MOMO, ORANGE, BANK)
- BTC/SAT: Crypto payout (CRYPTO method)
- USDT: Stablecoin (CRYPTO method)

Examples:
- DIRECT LIGHTNING to MOMO: targetCurrency = "XAF" (fiat recipient)
- QR LIGHTNING to CRYPTO: targetCurrency = "BTC" or "SAT" (crypto recipient)
- REQUEST CREATE: targetCurrency = "XAF" (currency to receive invoice in)
    `,
  })
  @ValidateIf((o) => o.flow !== FlowType.REQUEST || o.action === PaymentAction.CREATE)
  @IsEnum(CurrencyCode)
  targetCurrency?: CurrencyCode;

  // ============================
  // PAYMENT METHODS
  // ============================
  @ApiPropertyOptional({
    example: 'LIGHTNING',
    description: `Payment method (HOW PAYER PAYS). Supported: BTC, LIGHTNING, MOMO, ORANGE, CARD, BANK

⚠️ CRITICAL: NOT for REQUEST CREATE!
- For REQUEST CREATE: Recipient doesn't choose payment method (payer decides it when settling)
- For REQUEST PAY: Payer specifies how they pay the invoice

Determines payer's wallet/platform:
- BTC: On-chain Bitcoin (slower, higher fees, settled on-chain)
- LIGHTNING: Lightning Network (instant, micropayments, <$1 typically)
- MOMO: Mobile money via MTN/Orange (fiat, requires phone or unregistered guest)
- ORANGE: Orange Money (fiat)
- CARD: Credit/debit card (future)
- BANK: Bank transfer (future)

Usage by flow:
- **DIRECT**: Payer specifies paymentMethod (how they send)
- **QR**: Payer specifies paymentMethod (how they send to recipient handle)
- **REQUEST CREATE**: ❌ DO NOT USE (recipient specifies payoutMethod instead)
- **REQUEST PAY**: Payer specifies paymentMethod (how they pay the invoice)

Examples:
- DIRECT LIGHTNING: paymentMethod = "LIGHTNING", baseCurrency = BTC/SAT
- DIRECT MOMO: paymentMethod = "MOMO", baseCurrency = XAF
- REQUEST PAY LIGHTNING: paymentMethod = "LIGHTNING", baseCurrency = BTC/SAT
- REQUEST PAY MOMO: paymentMethod = "MOMO", baseCurrency = XAF

❌ WRONG for REQUEST CREATE:
{ "flow": "REQUEST", "action": "CREATE", "paymentMethod": "MOMO" } ← INVALID

✅ RIGHT for REQUEST CREATE:
{ "flow": "REQUEST", "action": "CREATE", "payoutMethod": "MOMO" } ← CORRECT
    `,
  })
  @ValidateIf((o) => o.flow !== FlowType.REQUEST || o.action === PaymentAction.PAY)
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({
    example: 'MOMO',
    description: `Payout method (HOW RECIPIENT RECEIVES). Supported: MOMO, ORANGE, BANK, CRYPTO

⚠️ CRITICAL DIFFERENCES BY FLOW:

**REQUEST CREATE: ESSENTIAL FIELD**
- Recipient specifies payoutMethod (how they want to receive the invoice payment)
- Required: For REQUEST CREATE with MOMO payout
- Examples:
  * { "flow": "REQUEST", "action": "CREATE", "amount": 5000, "amountType": "RECEIVE", "targetCurrency": "XAF", "payoutMethod": "MOMO" }
  * Guest: add payerPhone to above

**REQUEST PAY: DO NOT USE**
- ❌ Payout method is LOCKED in the invoice when it was created
- Do NOT include payoutMethod in REQUEST PAY requests
- Wrong: { "flow": "REQUEST", "action": "PAY", "payoutMethod": "MOMO" } ← INVALID

**DIRECT: Optional**
- Specifies recipient's settlement method
- Auto-uses recipient's wallet if not specified

**QR: IGNORED**
- ⚠️ All QR payments currently use MOMO payout only (BANK/CRYPTO support coming soon)

Determines recipient's settlement method:
- MOMO: MTN Mobile Money (fiat, instant)
- ORANGE: Orange Money (fiat, instant)
- BANK: Bank account (fiat, 1-3 business days)
- CRYPTO: Cryptocurrency wallet (BTC HODL, Lightning Network, USDT, etc.)

Currency pairing:
- MOMO/ORANGE/BANK → targetCurrency = XAF (fiat)
- CRYPTO → targetCurrency = BTC/SAT/USDT (crypto)

Examples by flow:
- DIRECT LIGHTNING→MOMO: payoutMethod = MOMO, targetCurrency = XAF
- DIRECT MOMO→CRYPTO: payoutMethod = CRYPTO, targetCurrency = BTC
- REQUEST CREATE MOMO: payoutMethod = MOMO, targetCurrency = XAF
- REQUEST PAY: ❌ DO NOT INCLUDE payoutMethod
    `,
  })
  @IsOptional()
  @IsString()
  payoutMethod?: string;

  // ============================
  // DIRECT FLOW → PHONE REQUIRED
  // ============================
  @ApiPropertyOptional({
    example: '670654321',
    description: `Recipient phone number for DIRECT flow payments.

Required ONLY when: flow = DIRECT
Not used for: QR, REQUEST flows

Phone resolution process:
1. System looks up registered user by phone
2. If no registered user → uses phone as unregistered guest recipient
3. Determines payout method from recipient's wallet settings or payoutMethod param

Phone format: E.164 (International) or national
- International: +237670654321 or 237670654321
- National: 670654321 (auto-prefixed with country code)

Examples:
- DIRECT LIGHTNING to MOMO: "670654321" → system finds registered user or guest
- DIRECT MOMO to MOMO (guest): "670000000" → unregistered guest, MOMO wallet created
- DIRECT MOMO to CRYPTO (registered): "670111111" → registered user with crypto wallet

Error cases:
- Missing when flow = DIRECT → validation error
- Recipient not found and payoutMethod ambiguous → error
    `
  })
  @ValidateIf((o) => o.flow === FlowType.DIRECT)
  @IsNotEmpty()
  @IsString()
  recipientPhone?: string;

  // ============================
  // PAYER PHONE (For unregistered users or MOMO payments)
  // ============================
  @ApiPropertyOptional({
    example: '674567325',
    description: `Payer/Guest phone number (MOMO number to receive or send funds).

⚠️  REQUIRED FOR REQUEST CREATE (GUEST USERS):
When creating an invoice as a guest user, payerPhone is the MOMO number you want to receive payment on.
Registered users automatically use their verified phone, no payerPhone needed.

Examples:
REQUEST CREATE - Guest: { "flow": "REQUEST", "action": "CREATE", "amount": 50000, "amountType": "RECEIVE", "targetCurrency": "XAF", "payoutMethod": "MOMO", "payerPhone": "674567325" }
REQUEST CREATE - Registered: { "flow": "REQUEST", "action": "CREATE", "amount": 50000, "amountType": "RECEIVE", "targetCurrency": "XAF", "payoutMethod": "MOMO" }

OTHER REQUIRED CASES:

1. **DIRECT/QR - Guest paying via MOMO/ORANGE**
   - Guest payer must provide their MOMO number to send from
   - Examples:
     * DIRECT MOMO (guest): payerPhone = "670111111", recipientPhone = "670000000"
     * QR MOMO (guest): payerPhone = "670222222", recipientHandle = "@alice"

2. **DIRECT/QR - Registered user paying via MOMO WITHOUT verified phone**
   - User account exists but phone not verified
   - Mobile money provider requires phone confirmation
   - payerPhone bypasses unverified phone validation

3. **REQUEST PAY - Guest paying via MOMO**
   - Guest payer must provide their MOMO number to send payment from
   - Example: REQUEST PAY (guest MOMO): payerPhone = "670333333", invoiceReference = "REQ-123"

OPTIONAL IN THESE CASES:
- LIGHTNING payment (registered or guest) → phone for contact tracing only
- Registered user with verified phone on account → auto-resolved from stored contact
- Registered user paying via MOMO with verified phone → auto-resolved

NOT NEEDED:
- Registered user with crypto wallet paying via LIGHTNING/BTC
- Registered user with verified phone creating REQUEST

Summary matrix:
+──────────────┬────────────┬──────────────────┬──────────────────+
| Flow         | User Type  | Payment Method   | payerPhone Needed|
+──────────────┼────────────┼──────────────────┼──────────────────+
| DIRECT       | Guest      | MOMO             | ✓ REQUIRED       |
| DIRECT       | Guest      | LIGHTNING        | Optional         |
| DIRECT       | Registered | MOMO (no verify) | ✓ REQUIRED       |
| DIRECT       | Registered | MOMO (verified)  | ✗ Not needed     |
| QR           | Guest      | MOMO             | ✓ REQUIRED       |
| REQUEST CREA | Guest      | MOMO             | ✓ REQUIRED       |
| REQUEST CREA | Registered | MOMO             | ✗ Not needed     |
| REQUEST PAY  | Guest      | MOMO             | ✓ REQUIRED       |
| REQUEST PAY  | Registered | MOMO             | ✗ Not needed     |
+──────────────┴────────────┴──────────────────┴──────────────────+

Service-level validation enforces these requirements. DTO allows optional for flexibility.
    `,
  })
  @IsOptional()
  @IsString()
  payerPhone?: string;

  // ============================
  // QR FLOW → HANDLE REQUIRED
  // ============================
  @ApiPropertyOptional({
    example: '@tchoko-brian',
    description: `Recipient handle (username) for QR flow payments.

Required ONLY when: flow = QR
Not used for: DIRECT, REQUEST flows

Handle resolution process:
1. System looks up user by handle (e.g., @tchoko-brian)
2. Retrieves recipient's preferred payment method (MOMO, BANK, CRYPTO, etc.)
3. Routes payment based on targetCurrency + payoutMethod combination
4. If payoutMethod not specified, uses recipient's default

Handle format:
- Must start with @ (e.g., @tchoko-alice, @john-doe)
- Case-insensitive lookup (e.g., @JOHN-DOE same as @john-doe)
- Globally unique per platform

Examples:
- DIRECT → NOT applicable (use recipientPhone instead)
- QR LIGHTNING to @tchoko-brian (registered): system finds Brian's preferred wallet
- QR MOMO to @alice-smith (registered): payoutMethod = MOMO, targetCurrency = XAF
- QR CRYPTO to @bob (registered BTC holder): payoutMethod = CRYPTO, targetCurrency = BTC

Error cases:
- Handle not found → "Recipient not found" error
- Handle exists but payoutMethod requirements ambiguous → error to clarify MOMO/BANK/CRYPTO
- Missing when flow = QR → validation error
    `,
  })
  @ValidateIf((o) => o.flow === FlowType.QR)
  @IsNotEmpty()
  @IsString()
  recipientHandle?: string;

  // ============================
  // REQUEST PAY → INVOICE REFERENCE REQUIRED
  // ============================
  @ApiPropertyOptional({
    example: 'INV-1774406561780',
    description: `Unique invoice reference to pay (required for REQUEST PAY action).

Required ONLY when: flow = REQUEST AND action = PAY
Not used for: DIRECT, QR, REQUEST CREATE

Reference format (Branded):
- INV-TIMESTAMP (created by request CREATE): e.g., INV-1774406561780
- REQ-TIMESTAMP (alternative format): e.g., REQ-1774408197902
- Human-readable, shareable via link/SMS/QR

Invoice lookup process:
1. System finds invoice by reference (case-insensitive)
2. Validates invoice NOT already paid (status = PENDING)
3. Checks expiry time (defaults to 1 hour)
4. Returns quote embedded in invoice (amount, exchangeRate, fee)
5. Proceeds with payment using invoice's original currency pair

Invoice status flow:
1. PENDING → payment ready
2. PAID → invoice fulfilled, no more payments accepted
3. EXPIRED → past expiry time (no payments accepted unless refreshed)
4. CANCELLED → merchant cancelled (no payments accepted)

Examples:
- REQUEST PAY (registered LIGHTNING user):
  {
    "flow": "REQUEST",
    "action": "PAY",
    "invoiceReference": "INV-1774406561780",
    "baseCurrency": "BTC",
    "paymentMethod": "LIGHTNING"
  }

- REQUEST PAY (guest MOMO user):
  {
    "flow": "REQUEST",
    "action": "PAY",
    "invoiceReference": "REQ-1774408197902",
    "baseCurrency": "XAF",
    "paymentMethod": "MOMO",
    "payerPhone": "670111111"
  }

Error cases:
- Invoice not found → 404 error
- Invoice already paid → "Invoice already fulfilled" error
- Invoice expired → "Invoice expired" error (can request extension)
- Reference format invalid → validation error
    `,
  })
  @ValidateIf((o) => o.flow === FlowType.REQUEST && o.action === PaymentAction.PAY)
  @IsNotEmpty()
  @IsString()
  invoiceReference?: string;

  // ============================
  // COUNTRY (ISO2 — recipient's country)
  // ============================
  @ApiPropertyOptional({
    example: 'CM',
    description: `ISO2 country of the RECEIVER (payout country).
Determines which Netwalletpay providers are used for the payout leg.
Defaults to CM (Cameroon) when omitted.
Supported: CM, UG, KE, TZ, RW, BI, GH, ZM, GQ, ZA, NG, MY
    `,
  })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    example: 'CM',
    description: `ISO2 country of the PAYER (payin country).
Used to select the correct Netwalletpay collection provider and phone-number prefix.
When omitted the system derives it from the payer phone prefix or falls back to 'country'.
Supported: CM, UG, KE, TZ, RW, BI, GH, ZM, GQ, ZA, NG, MY
    `,
  })
  @IsOptional()
  @IsString()
  payerCountry?: string;

  // ============================
  // OPTIONAL: DESCRIPTION
  // ============================
  @ApiPropertyOptional({
    example: 'Payment for shoes - order #12345',
    description: `Optional payment description/memo.

Use cases:
- Reference for merchant records (order number, invoice ID, etc.)
- User-visible in payment history on both ends
- Searchable in transaction logs
- Optional; system generates generic description if omitted

Examples:
- "Payment for services rendered"
- "Loan repayment - monthly installment"
- "Invoice #INV-001234 - SaaS subscription"
- "Refund for returned items"

Length: 1-500 characters
Encoding: UTF-8 (supports emoji, accented characters)
    `
  })
  @IsOptional()
  @IsString()
  description?: string;

  // ============================
  // OPTIONAL: IDEMPOTENCY KEY
  // ============================
  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: `UUID for idempotent payment retry (exactly-once guarantee).

Idempotency ensures: Same request → Same response, even if retried multiple times

Use cases:
1. Network timeout → client retries with same idempotencyKey
2. Duplicate protection → second request with same key returns original response
3. Transaction consistency → never charges twice even on concurrent requests

How it works:
1. Client generates UUID v4: 550e8400-e29b-41d4-a716-446655440000
2. First request: processes payment, caches response
3. Retry with same key: returns cached response without reprocessing
4. Different key = different payment (will charge again)

Idempotency scope:
- Per user per endpoint per key
- Expires after 24 hours (cached response deleted)
- Backend intercepts duplicate requests BEFORE processing

Examples - Lightning payment with retry:
// First attempt (network error)
POST /payments
{
  "flow": "DIRECT",
  "amount": 0.0001,
  "baseCurrency": "BTC",
  "paymentMethod": "LIGHTNING",
  "recipientPhone": "670000000",
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000"
}
→ Network timeout, client doesn't get response

// Retry (same key → no recharge)
POST /payments
{
  ...same payload...,
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000"
}
→ Returns original response instantly (payment NOT duplicated)

Examples - REQUEST PAY with idempotency:
// Payer retries invoice payment multiple times
{
  "flow": "REQUEST",
  "action": "PAY",
  "invoiceReference": "INV-1774406561780",
  "paymentMethod": "LIGHTNING",
  "idempotencyKey": "abc12345-abcd-1234-abcd-1234567890ab"
}
→ First call: charges 0.0001 BTC, creates transaction
→ Second call (same key): confirms original transaction paid, no second charge
→ Third call (same key): same result as second call

Format: UUID v4 format (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
Generation: Use crypto library or online UUID generator
Optional: If omitted, every request treated as new (not idempotent)
    `
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  /**
   * Netwalletpay provider code for the PAYIN (payer's network).
   * When provided, routes directly to this provider without auto-detection.
   * Example: "mpesa_ke", "mtn_cm", "airtel_tz"
   */
  @IsOptional()
  @IsString()
  paymentProviderCode?: string;

  /**
   * Netwalletpay provider code for the PAYOUT (recipient's network).
   * When provided, routes directly to this provider without auto-detection.
   * Example: "mpesa_ke", "orange_cm", "bank_ng"
   */
  @IsOptional()
  @IsString()
  payoutProviderCode?: string;
}