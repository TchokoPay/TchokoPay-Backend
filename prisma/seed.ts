import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error('DIRECT_URL environment variable is not set');

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const aggregators = [
  { code: 'netwalletpay', name: 'Netwalletpay' },
  { code: 'blink',        name: 'Blink (Lightning)' },
];

/**
 * Active countries — only those with at least one REAL named provider
 * (not just netwallet_xx fallback). Verified 2026-05-12.
 *
 * Excluded (only had netwallet_xx, which is now deactivated):
 *   RW, BI, GH, ZM, EG
 */
const countries = [
  { iso2: 'CM', name: 'Cameroon',     currency: 'XAF', dialCode: '+237' },
  { iso2: 'KE', name: 'Kenya',        currency: 'KES', dialCode: '+254' },
  { iso2: 'TZ', name: 'Tanzania',     currency: 'TZS', dialCode: '+255' },
  { iso2: 'UG', name: 'Uganda',       currency: 'UGX', dialCode: '+256' },
  { iso2: 'NG', name: 'Nigeria',      currency: 'NGN', dialCode: '+234' },
  { iso2: 'ZA', name: 'South Africa', currency: 'ZAR', dialCode: '+27'  },
];

const methods = [
  { code: 'MOBILE_MONEY',  name: 'Mobile Money'  },
  { code: 'CARD',          name: 'Card'          },
  { code: 'BANK',          name: 'Bank'          },
  { code: 'CRYPTO',        name: 'Crypto'        },
  { code: 'NETWALLET_PAY', name: 'Netwallet Pay' },
];

/**
 * VERIFIED provider codes — sourced by live API calls on 2026-05-12:
 *   GET /api/v1/lookup/get-providers/COLLECTION/MOBILE_MONEY/{COUNTRY}
 *   GET /api/v1/lookup/get-providers/PAYOUT/MOBILE_MONEY/{COUNTRY}
 *
 * Every provider listed here was returned by Netwalletpay's own API.
 * Provider codes that were NOT returned have been removed (mtn_rw, airtel_rw,
 * econet_bi, lumicash_bi, mtn_gh, vodafone_gh, airtel_gh, mtn_zm, airtel_zm,
 * zamtel_zm, fnb_za, standard_za, absa_za, card_ng — none existed on API).
 *
 * requiresType = true → MethodType field needed (CM only per Netwalletpay docs).
 * MethodType values: MOMO (mtn_cm), ORANGE_MONEY (orange_cm), EU (eu_cm), MOMO (netwallet_cm default)
 */
const providers = [
  // ── Cameroon (CM) — MTN + Orange only (eu_cm and netwallet_cm deactivated) ─
  { providerCode: 'mtn_cm',    name: 'MTN MoMo',     country: 'CM', method: 'MOBILE_MONEY', requiresType: true  },
  { providerCode: 'orange_cm', name: 'Orange Money', country: 'CM', method: 'MOBILE_MONEY', requiresType: true  },

  // ── Kenya (KE) — M-Pesa + Airtel (netwallet_ke deactivated) ───────────────
  { providerCode: 'mpesa_ke',  name: 'M-Pesa',       country: 'KE', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_ke', name: 'Airtel Money', country: 'KE', method: 'MOBILE_MONEY', requiresType: false },

  // ── Tanzania (TZ) — 5 named providers (netwallet_tz deactivated) ──────────
  { providerCode: 'vodacom_tz',  name: 'Vodacom M-Pesa', country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_tz',   name: 'Airtel Money',   country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'tigo_tz',     name: 'Tigo Pesa',      country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'azampesa_tz', name: 'AzamPesa',       country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'halopesa_tz', name: 'HaloPesa',       country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },

  // ── Uganda (UG) — MTN + Airtel (netwallet_ug deactivated) ────────────────
  { providerCode: 'mtn_ug',    name: 'MTN MoMo',     country: 'UG', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_ug', name: 'Airtel Money', country: 'UG', method: 'MOBILE_MONEY', requiresType: false },

  // ── Nigeria (NG) — bank transfer only (netwallet_ng deactivated) ──────────
  { providerCode: 'bank_ng', name: 'Bank Transfer', country: 'NG', method: 'BANK', requiresType: false },

  // ── South Africa (ZA) — bank transfer only (netwallet_za deactivated) ─────
  { providerCode: 'bank_za', name: 'Bank Transfer', country: 'ZA', method: 'BANK', requiresType: false },

  // RW, BI, GH, ZM, EG had ONLY netwallet_xx — those countries are now excluded
  // (soft-deactivated via the countries notIn filter above).
];

async function main() {
  console.log('🌱 Seeding (verified against live Netwalletpay API)...');

  // 0. Upsert aggregators
  const aggregatorRecords = await Promise.all(
    aggregators.map(({ code, name }) =>
      prisma.paymentAggregator.upsert({
        where: { code },
        create: { code, name },
        update: { name, isActive: true },
      }),
    ),
  );
  const aggregatorMap = Object.fromEntries(aggregatorRecords.map((a) => [a.code, a.id]));
  const netwalletpayId = aggregatorMap['netwalletpay'];
  console.log(`  ✔ ${aggregators.length} aggregators`);

  // 1. Upsert currencies + countries; soft-deactivate removed ones
  await Promise.all(
    countries.map(async ({ iso2, name, currency, dialCode }) => {
      const cur = await prisma.currency.upsert({
        where: { code: currency },
        create: { code: currency, name: currency, symbol: currency, decimals: 2, isCrypto: false },
        update: { name: currency },
      });
      await prisma.country.upsert({
        where: { iso2 },
        create: { iso2, name, dialCode, currency: { connect: { id: cur.id } } },
        update: { name, dialCode, isActive: true, currencyId: cur.id },
      });
    }),
  );
  await prisma.country.updateMany({
    where: { iso2: { notIn: countries.map((c) => c.iso2) } },
    data: { isActive: false },
  });
  console.log(`  ✔ ${countries.length} countries (unlisted soft-deactivated)`);

  // 2. Payment method categories
  await Promise.all(
    methods.map((m) =>
      prisma.paymentMethodRef.upsert({
        where: { code: m.code },
        create: m,
        update: { name: m.name, isActive: true },
      }),
    ),
  );
  console.log(`  ✔ ${methods.length} payment method refs`);

  // 3. Upsert verified providers; soft-deactivate removed ones
  const validCodes = providers.map((p) => p.providerCode);
  let seeded = 0;

  await Promise.all(
    providers.map(async ({ providerCode, name, country, method, requiresType }) => {
      const countryRec = await prisma.country.findUnique({ where: { iso2: country } });
      const methodRec  = await prisma.paymentMethodRef.findUnique({ where: { code: method } });
      if (!countryRec || !methodRec) {
        console.warn(`  ⚠  Skip ${providerCode}: country/method not found`);
        return;
      }
      await prisma.paymentProvider.upsert({
        where: { providerCode },
        create: { providerCode, name, aggregatorId: netwalletpayId, countryId: countryRec.id, methodId: methodRec.id, requiresType },
        update: { name, aggregatorId: netwalletpayId, countryId: countryRec.id, methodId: methodRec.id, requiresType, isActive: true },
      });
      seeded++;
    }),
  );

  // Deactivate any provider that is no longer in the verified list
  await prisma.paymentProvider.updateMany({
    where: { aggregator: { code: 'netwalletpay' }, providerCode: { notIn: validCodes } },
    data: { isActive: false },
  });
  console.log(`  ✔ ${seeded} providers seeded (non-listed soft-deactivated)`);
  // 4. Seed default transaction limits per currency
  // Based on country minimum operator requirements + sensible maximums.
  // Admins can override these from the dashboard.
  const limits = [
    { currencyCode: 'XAF', minAmount: 100,       maxAmount: 5_000_000  }, // CFA Franc (CM + GQ)
    { currencyCode: 'KES', minAmount: 100,        maxAmount: 300_000    }, // Kenyan Shilling
    { currencyCode: 'TZS', minAmount: 500,        maxAmount: 10_000_000 }, // Tanzanian Shilling
    { currencyCode: 'UGX', minAmount: 500,        maxAmount: 10_000_000 }, // Ugandan Shilling
    { currencyCode: 'NGN', minAmount: 100,        maxAmount: 5_000_000  }, // Nigerian Naira
    { currencyCode: 'ZAR', minAmount: 10,         maxAmount: 200_000    }, // South African Rand
    // Crypto — kept high to avoid dust amounts
    { currencyCode: 'BTC', minAmount: 0.000_010,  maxAmount: 1          }, // Bitcoin
    { currencyCode: 'SAT', minAmount: 1_000,      maxAmount: 100_000_000}, // Satoshis
    { currencyCode: 'USD', minAmount: 1,          maxAmount: 50_000     }, // US Dollar (USDT)
  ];

  for (const { currencyCode, minAmount, maxAmount } of limits) {
    const cur = await prisma.currency.findUnique({ where: { code: currencyCode } });
    if (!cur) continue; // skip if currency not seeded
    await prisma.transactionLimit.upsert({
      where: { currencyCode },
      create: { currencyCode, minAmount, maxAmount },
      update: { minAmount, maxAmount, isActive: true },
    });
  }
  console.log(`  ✔ ${limits.length} transaction limits seeded`);

  console.log('\n✅ Seed complete — matches live Netwalletpay API.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
