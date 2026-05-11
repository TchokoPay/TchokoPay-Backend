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
 * Countries confirmed in the NetwalletpayCountry type in netwalletpay.provider.ts.
 * Source of truth: | 'UG' | 'KE' | 'TZ' | 'RW' | 'BI' | 'GH' | 'CM' | 'ZA' | 'NG' | 'ZM'
 *
 * DO NOT add a country here unless it appears in that type — adding unconfirmed
 * countries will surface to users but fail silently when Netwalletpay returns
 * 0 providers for that country code.
 */
const countries = [
  // ── Central Africa ────────────────────────────────────────────────
  { iso2: 'CM', name: 'Cameroon',      currency: 'XAF', dialCode: '+237' },

  // ── East Africa ───────────────────────────────────────────────────
  { iso2: 'KE', name: 'Kenya',         currency: 'KES', dialCode: '+254' },
  { iso2: 'TZ', name: 'Tanzania',      currency: 'TZS', dialCode: '+255' },
  { iso2: 'UG', name: 'Uganda',        currency: 'UGX', dialCode: '+256' },
  { iso2: 'RW', name: 'Rwanda',        currency: 'RWF', dialCode: '+250' },
  { iso2: 'BI', name: 'Burundi',       currency: 'BIF', dialCode: '+257' },

  // ── West Africa ───────────────────────────────────────────────────
  { iso2: 'GH', name: 'Ghana',         currency: 'GHS', dialCode: '+233' },
  { iso2: 'NG', name: 'Nigeria',       currency: 'NGN', dialCode: '+234' },

  // ── Southern Africa ───────────────────────────────────────────────
  { iso2: 'ZA', name: 'South Africa',  currency: 'ZAR', dialCode: '+27'  },
  { iso2: 'ZM', name: 'Zambia',        currency: 'ZMW', dialCode: '+260' },
];

const methods = [
  { code: 'MOBILE_MONEY',  name: 'Mobile Money'  },
  { code: 'CARD',          name: 'Card'          },
  { code: 'BANK',          name: 'Bank'          },
  { code: 'CRYPTO',        name: 'Crypto'        },
  { code: 'NETWALLET_PAY', name: 'Netwallet Pay' },
];

/**
 * Provider codes from GET /api/v1/lookup/get-providers/{type}/{method}/{country}.
 *
 * requiresType = true → MethodType field is required in Netwalletpay API calls.
 * For CM MOBILE_MONEY: valid MethodType values are MOMO (MTN), ORANGE_MONEY (Orange), EU.
 *
 * Only add providers you have verified through verifyProviderConfig() or the live
 * lookup endpoint — these codes are sent directly in the MethodProvider field.
 */
const providers = [
  // ── Cameroon (CM) ─────────────────────────────────────────────────
  // MethodType required; mtn_cm → MOMO, orange_cm → ORANGE_MONEY
  { providerCode: 'mtn_cm',       name: 'MTN Mobile Money',  country: 'CM', method: 'MOBILE_MONEY',  requiresType: true  },
  { providerCode: 'orange_cm',    name: 'Orange Money',       country: 'CM', method: 'MOBILE_MONEY',  requiresType: true  },
  { providerCode: 'netwallet_cm', name: 'Netwallet Pay',      country: 'CM', method: 'NETWALLET_PAY', requiresType: false },

  // ── Kenya (KE) ────────────────────────────────────────────────────
  { providerCode: 'mpesa_ke',  name: 'M-Pesa',       country: 'KE', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_ke', name: 'Airtel Money',  country: 'KE', method: 'MOBILE_MONEY', requiresType: false },

  // ── Tanzania (TZ) ─────────────────────────────────────────────────
  { providerCode: 'vodacom_tz', name: 'Vodacom M-Pesa', country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_tz',  name: 'Airtel Money',   country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'tigo_tz',    name: 'Tigo Pesa',      country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },

  // ── Uganda (UG) ───────────────────────────────────────────────────
  { providerCode: 'mtn_ug',    name: 'MTN Mobile Money', country: 'UG', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_ug', name: 'Airtel Money',     country: 'UG', method: 'MOBILE_MONEY', requiresType: false },

  // ── Rwanda (RW) ───────────────────────────────────────────────────
  { providerCode: 'mtn_rw',    name: 'MTN Mobile Money', country: 'RW', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_rw', name: 'Airtel Money',     country: 'RW', method: 'MOBILE_MONEY', requiresType: false },

  // ── Burundi (BI) ──────────────────────────────────────────────────
  { providerCode: 'econet_bi',   name: 'Econet Leo', country: 'BI', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'lumicash_bi', name: 'Lumicash',   country: 'BI', method: 'MOBILE_MONEY', requiresType: false },

  // ── Ghana (GH) ────────────────────────────────────────────────────
  { providerCode: 'mtn_gh',      name: 'MTN Mobile Money',  country: 'GH', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'vodafone_gh', name: 'Vodafone Cash',     country: 'GH', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_gh',   name: 'AirtelTigo Money',  country: 'GH', method: 'MOBILE_MONEY', requiresType: false },

  // ── Nigeria (NG) — card collection only ───────────────────────────
  // Netwalletpay only confirms card for NG (no mobile money).
  // Do NOT add mtn_ng / airtel_ng until confirmed via verifyProviderConfig().
  { providerCode: 'card_ng', name: 'Card Payment', country: 'NG', method: 'CARD', requiresType: false },

  // ── South Africa (ZA) — bank collection + payout ──────────────────
  { providerCode: 'fnb_za',      name: 'FNB',           country: 'ZA', method: 'BANK', requiresType: false },
  { providerCode: 'standard_za', name: 'Standard Bank', country: 'ZA', method: 'BANK', requiresType: false },
  { providerCode: 'absa_za',     name: 'ABSA',          country: 'ZA', method: 'BANK', requiresType: false },

  // ── Zambia (ZM) ───────────────────────────────────────────────────
  { providerCode: 'mtn_zm',    name: 'MTN Mobile Money', country: 'ZM', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_zm', name: 'Airtel Money',     country: 'ZM', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'zamtel_zm', name: 'Zamtel Money',     country: 'ZM', method: 'MOBILE_MONEY', requiresType: false },
];

async function main() {
  console.log('🌱 Seeding aggregators, countries, methods, and providers...');

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
  console.log(`  ✔ ${aggregators.length} aggregators upserted`);

  // 1. Upsert currencies + countries
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

  // Soft-deactivate countries that are no longer confirmed (SN, CI, GQ, MY, etc.)
  await prisma.country.updateMany({
    where: { iso2: { notIn: countries.map((c) => c.iso2) } },
    data: { isActive: false },
  });
  console.log(`  ✔ ${countries.length} countries upserted (removed countries soft-deactivated)`);

  // 2. Upsert payment method categories
  await Promise.all(
    methods.map((m) =>
      prisma.paymentMethodRef.upsert({
        where: { code: m.code },
        create: m,
        update: { name: m.name, isActive: true },
      }),
    ),
  );
  console.log(`  ✔ ${methods.length} payment methods upserted`);

  // 3. Upsert Netwalletpay providers
  let seeded = 0, skipped = 0;
  const validCodes = providers.map((p) => p.providerCode);

  await Promise.all(
    providers.map(async ({ providerCode, name, country, method, requiresType }) => {
      const countryRec = await prisma.country.findUnique({ where: { iso2: country } });
      const methodRec  = await prisma.paymentMethodRef.findUnique({ where: { code: method } });
      if (!countryRec || !methodRec) {
        console.warn(`  ⚠  Skipping ${providerCode}: country/method not found`);
        skipped++;
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

  // Soft-deactivate providers that were removed (SN/CI/GQ providers, speculative NG/ZA extras)
  await prisma.paymentProvider.updateMany({
    where: {
      aggregator: { code: 'netwalletpay' },
      providerCode: { notIn: validCodes },
    },
    data: { isActive: false },
  });

  console.log(`  ✔ ${seeded} providers seeded (${skipped} skipped, extras soft-deactivated)`);
  console.log('\n✅ Seed complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
