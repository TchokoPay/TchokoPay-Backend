import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error('DIRECT_URL environment variable is not set');

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ── Aggregators ──────────────────────────────────────────────────────────────
// priority: lower number = higher priority (tried first in payment routing)
const aggregators = [
  { code: 'netwalletpay', name: 'Netwalletpay',    priority: 1 },
  { code: 'zikopay',      name: 'ZikoPay',          priority: 2 },
  { code: 'blink',        name: 'Blink (Lightning)', priority: 10 },
];

// ── Countries ────────────────────────────────────────────────────────────────
// Netwalletpay-verified countries (2026-05-12) + ZikoPay-only countries
const countries = [
  // Netwalletpay primary
  { iso2: 'CM', name: 'Cameroon',         currency: 'XAF', dialCode: '+237' },
  { iso2: 'KE', name: 'Kenya',            currency: 'KES', dialCode: '+254' },
  { iso2: 'TZ', name: 'Tanzania',         currency: 'TZS', dialCode: '+255' },
  { iso2: 'UG', name: 'Uganda',           currency: 'UGX', dialCode: '+256' },
  { iso2: 'NG', name: 'Nigeria',          currency: 'NGN', dialCode: '+234' },
  { iso2: 'ZA', name: 'South Africa',     currency: 'ZAR', dialCode: '+27'  },
  // ZikoPay-only (West Africa)
  { iso2: 'CI', name: "Côte d'Ivoire",   currency: 'XOF', dialCode: '+225' },
  { iso2: 'SN', name: 'Senegal',          currency: 'XOF', dialCode: '+221' },
  { iso2: 'BJ', name: 'Benin',            currency: 'XOF', dialCode: '+229' },
  { iso2: 'TG', name: 'Togo',             currency: 'XOF', dialCode: '+228' },
  { iso2: 'GH', name: 'Ghana',            currency: 'GHS', dialCode: '+233' },
];

const extraCurrencies = [
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'XOF', decimals: 0 },
  { code: 'GHS', name: 'Ghanaian Cedi',          symbol: 'GHS', decimals: 2 },
];

const methods = [
  { code: 'MOBILE_MONEY',  name: 'Mobile Money'  },
  { code: 'CARD',          name: 'Card'          },
  { code: 'BANK',          name: 'Bank'          },
  { code: 'CRYPTO',        name: 'Crypto'        },
  { code: 'NETWALLET_PAY', name: 'Netwallet Pay' },
];

// ── Netwalletpay providers ───────────────────────────────────────────────────
// Verified via GET /api/v1/lookup/get-providers/COLLECTION/MOBILE_MONEY/{country}
// on 2026-05-12. Only real named providers (no netwallet_xx fallbacks).
const netwalletpayProviders = [
  // CM — MethodType required: mtn_cm→MOMO, orange_cm→ORANGE_MONEY
  { providerCode: 'mtn_cm',       name: 'MTN MoMo',       country: 'CM', method: 'MOBILE_MONEY', requiresType: true  },
  { providerCode: 'orange_cm',    name: 'Orange Money',    country: 'CM', method: 'MOBILE_MONEY', requiresType: true  },
  // KE
  { providerCode: 'mpesa_ke',     name: 'M-Pesa',          country: 'KE', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_ke',    name: 'Airtel Money',    country: 'KE', method: 'MOBILE_MONEY', requiresType: false },
  // TZ
  { providerCode: 'vodacom_tz',   name: 'Vodacom M-Pesa',  country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_tz',    name: 'Airtel Money',    country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'tigo_tz',      name: 'Tigo Pesa',       country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'azampesa_tz',  name: 'AzamPesa',        country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'halopesa_tz',  name: 'HaloPesa',        country: 'TZ', method: 'MOBILE_MONEY', requiresType: false },
  // UG
  { providerCode: 'mtn_ug',       name: 'MTN MoMo',        country: 'UG', method: 'MOBILE_MONEY', requiresType: false },
  { providerCode: 'airtel_ug',    name: 'Airtel Money',    country: 'UG', method: 'MOBILE_MONEY', requiresType: false },
  // NG — bank transfer
  { providerCode: 'bank_ng',      name: 'Bank Transfer',   country: 'NG', method: 'BANK',         requiresType: false },
  // ZA — bank transfer
  { providerCode: 'bank_za',      name: 'Bank Transfer',   country: 'ZA', method: 'BANK',         requiresType: false },
];

// ── ZikoPay providers ────────────────────────────────────────────────────────
// Source: https://docs.zikopay.com — operator codes used in their API requests.
// Prefixed with 'ziko_' to distinguish from Netwalletpay codes in our DB.
const zikoPayProviders = [
  // CM — overlaps with Netwalletpay; ZikoPay is fallback (priority 2)
  { providerCode: 'ziko_mtn_cm',    name: 'MTN MoMo',      country: 'CM', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'mtn_cm'    },
  { providerCode: 'ziko_orange_cm', name: 'Orange Money',   country: 'CM', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'orange_cm' },
  // CI — ZikoPay exclusive
  { providerCode: 'ziko_mtn_ci',    name: 'MTN MoMo',      country: 'CI', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'mtn_ci'    },
  { providerCode: 'ziko_orange_ci', name: 'Orange Money',   country: 'CI', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'orange_ci' },
  { providerCode: 'ziko_moov_ci',   name: 'Moov Money',     country: 'CI', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'moov_ci'   },
  { providerCode: 'ziko_wave_ci',   name: 'Wave',           country: 'CI', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'wave_ci'   },
  // SN — ZikoPay exclusive
  { providerCode: 'ziko_orange_sn', name: 'Orange Money',   country: 'SN', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'orange_sn' },
  { providerCode: 'ziko_free_sn',   name: 'Free Money',     country: 'SN', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'free_sn'   },
  { providerCode: 'ziko_wave_sn',   name: 'Wave',           country: 'SN', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'wave_sn'   },
  // BJ — ZikoPay exclusive
  { providerCode: 'ziko_mtn_bj',    name: 'MTN MoMo',      country: 'BJ', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'mtn_bj'    },
  { providerCode: 'ziko_moov_bj',   name: 'Moov Money',     country: 'BJ', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'moov_bj'   },
  // TG — ZikoPay exclusive
  { providerCode: 'ziko_tmoney_tg', name: 'T-Money',        country: 'TG', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'tmoney_tg' },
  { providerCode: 'ziko_moov_tg',   name: 'Moov Money',     country: 'TG', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'moov_tg'   },
  // GH — fallback to ZikoPay (Netwalletpay only had netwallet_gh)
  { providerCode: 'ziko_mtn_gh',    name: 'MTN MoMo',      country: 'GH', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'mtn_gh'    },
  { providerCode: 'ziko_vodafone_gh',name: 'Vodafone Cash', country: 'GH', method: 'MOBILE_MONEY', requiresType: false, operatorCode: 'vodafone_gh'},
];

async function main() {
  console.log('🌱 Seeding aggregators, countries, methods, and providers...\n');

  // 0. Upsert aggregators with priority + soft-update existing
  const aggregatorRecords = await Promise.all(
    aggregators.map(({ code, name, priority }) =>
      prisma.paymentAggregator.upsert({
        where: { code },
        create: { code, name, priority, isActive: true },
        update: { name, priority, isActive: true },
      }),
    ),
  );
  const aggregatorMap = Object.fromEntries(aggregatorRecords.map((a) => [a.code, a.id]));
  const netwalletpayId = aggregatorMap['netwalletpay'];
  const zikoPayId      = aggregatorMap['zikopay'];
  console.log(`  ✔ ${aggregators.length} aggregators (with priority)`);

  // 1a. Extra currencies (XOF, GHS) before country upsert
  for (const cur of extraCurrencies) {
    await prisma.currency.upsert({
      where: { code: cur.code },
      create: cur,
      update: { name: cur.name },
    });
  }

  // 1b. Upsert countries; soft-deactivate removed ones
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
  console.log(`  ✔ ${countries.length} countries`);

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

  // 3. Netwalletpay providers
  const nwCodes: string[] = [];
  for (const { providerCode, name, country, method, requiresType } of netwalletpayProviders) {
    const countryRec = await prisma.country.findUnique({ where: { iso2: country } });
    const methodRec  = await prisma.paymentMethodRef.findUnique({ where: { code: method } });
    if (!countryRec || !methodRec) { console.warn(`  ⚠ Skip ${providerCode}`); continue; }
    await prisma.paymentProvider.upsert({
      where: { providerCode },
      create: { providerCode, name, aggregatorId: netwalletpayId, countryId: countryRec.id, methodId: methodRec.id, requiresType },
      update: { name, aggregatorId: netwalletpayId, countryId: countryRec.id, methodId: methodRec.id, requiresType, isActive: true },
    });
    nwCodes.push(providerCode);
  }
  // Deactivate removed Netwalletpay providers
  await prisma.paymentProvider.updateMany({
    where: { aggregator: { code: 'netwalletpay' }, providerCode: { notIn: nwCodes } },
    data: { isActive: false },
  });
  console.log(`  ✔ ${nwCodes.length} Netwalletpay providers`);

  // 4. ZikoPay providers — operatorCode stored in description field for use in API calls
  const zkCodes: string[] = [];
  for (const { providerCode, name, country, method, requiresType } of zikoPayProviders) {
    const countryRec = await prisma.country.findUnique({ where: { iso2: country } });
    const methodRec  = await prisma.paymentMethodRef.findUnique({ where: { code: method } });
    if (!countryRec || !methodRec) { console.warn(`  ⚠ Skip ${providerCode}`); continue; }
    await prisma.paymentProvider.upsert({
      where: { providerCode },
      // Store the ZikoPay operator code in the name field for API use
      create: { providerCode, name, aggregatorId: zikoPayId, countryId: countryRec.id, methodId: methodRec.id, requiresType },
      update: { name, aggregatorId: zikoPayId, countryId: countryRec.id, methodId: methodRec.id, requiresType, isActive: true },
    });
    zkCodes.push(providerCode);
  }
  await prisma.paymentProvider.updateMany({
    where: { aggregator: { code: 'zikopay' }, providerCode: { notIn: zkCodes } },
    data: { isActive: false },
  });
  console.log(`  ✔ ${zkCodes.length} ZikoPay providers`);

  // 5. Transaction limits
  const limits = [
    { currencyCode: 'XAF', minAmount: 100,       maxAmount: 5_000_000  },
    { currencyCode: 'KES', minAmount: 100,        maxAmount: 300_000    },
    { currencyCode: 'TZS', minAmount: 500,        maxAmount: 10_000_000 },
    { currencyCode: 'UGX', minAmount: 500,        maxAmount: 10_000_000 },
    { currencyCode: 'NGN', minAmount: 100,        maxAmount: 5_000_000  },
    { currencyCode: 'ZAR', minAmount: 10,         maxAmount: 200_000    },
    { currencyCode: 'XOF', minAmount: 100,        maxAmount: 5_000_000  },
    { currencyCode: 'GHS', minAmount: 5,          maxAmount: 50_000     },
    { currencyCode: 'BTC', minAmount: 0.000_010,  maxAmount: 1          },
    { currencyCode: 'SAT', minAmount: 1_000,      maxAmount: 100_000_000},
    { currencyCode: 'USD', minAmount: 1,          maxAmount: 50_000     },
  ];
  for (const { currencyCode, minAmount, maxAmount } of limits) {
    const cur = await prisma.currency.findUnique({ where: { code: currencyCode } });
    if (!cur) continue;
    await prisma.transactionLimit.upsert({
      where: { currencyCode },
      create: { currencyCode, minAmount, maxAmount },
      update: { minAmount, maxAmount, isActive: true },
    });
  }
  console.log(`  ✔ ${limits.length} transaction limits`);

  console.log('\n✅ Seed complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
