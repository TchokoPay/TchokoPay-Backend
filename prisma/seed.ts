import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) {
  throw new Error('DIRECT_URL environment variable is not set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const countries = [
  { iso2: 'CM', name: 'Cameroon', currency: 'XAF', dialCode: '+237' },
  { iso2: 'UG', name: 'Uganda', currency: 'UGX', dialCode: '+256' },
  { iso2: 'KE', name: 'Kenya', currency: 'KES', dialCode: '+254' },
  { iso2: 'TZ', name: 'Tanzania', currency: 'TZS', dialCode: '+255' },
  { iso2: 'RW', name: 'Rwanda', currency: 'RWF', dialCode: '+250' },
  { iso2: 'BI', name: 'Burundi', currency: 'BIF', dialCode: '+257' },
  { iso2: 'GH', name: 'Ghana', currency: 'GHS', dialCode: '+233' },
  { iso2: 'ZM', name: 'Zambia', currency: 'ZMW', dialCode: '+260' },
  { iso2: 'EG', name: 'Egypt', currency: 'EGP', dialCode: '+20' },
  { iso2: 'ZA', name: 'South Africa', currency: 'ZAR', dialCode: '+27' },
  { iso2: 'NG', name: 'Nigeria', currency: 'NGN', dialCode: '+234' },
  { iso2: 'US', name: 'United States', currency: 'USD', dialCode: '+1' },
  { iso2: 'GB', name: 'United Kingdom', currency: 'GBP', dialCode: '+44' },
  { iso2: 'EU', name: 'European Union', currency: 'EUR', dialCode: '+33' },
];

const methods = [
  { code: 'MOBILE_MONEY', name: 'Mobile Money' },
  { code: 'CARD', name: 'Card' },
  { code: 'BANK', name: 'Bank' },
  { code: 'CRYPTO', name: 'Crypto' },
  { code: 'NETWALLET_PAY', name: 'Netwallet Pay' },
];

const providers = [
  { providerCode: 'mtn_cm', name: 'MTN Mobile Money', country: 'CM', method: 'MOBILE_MONEY', requiresType: true },
  { providerCode: 'orange_cm', name: 'Orange Mobile Money', country: 'CM', method: 'MOBILE_MONEY', requiresType: true },
  { providerCode: 'eu_cm', name: 'EU', country: 'CM', method: 'MOBILE_MONEY', requiresType: true },
  { providerCode: 'netwallet_cm', name: 'Netwallet pay', country: 'CM', method: 'NETWALLET_PAY', requiresType: false },
  // Add additional provider entries to match supported countries/methods
  { providerCode: 'mtn_ug', name: 'MTN Mobile Money', country: 'UG', method: 'MOBILE_MONEY', requiresType: true },
  { providerCode: 'mtn_gh', name: 'MTN Mobile Money', country: 'GH', method: 'MOBILE_MONEY', requiresType: true },
  { providerCode: 'bank_za', name: 'Bank EFT', country: 'ZA', method: 'BANK', requiresType: false },
  { providerCode: 'card_us', name: 'Card Payment', country: 'US', method: 'CARD', requiresType: false },
  { providerCode: 'card_gb', name: 'Card Payment', country: 'GB', method: 'CARD', requiresType: false },
  { providerCode: 'card_eu', name: 'Card Payment', country: 'EU', method: 'CARD', requiresType: false },
];

async function main() {
  await Promise.all(countries.map(async (country) => {
    const currency = await prisma.currency.upsert({
      where: { code: country.currency },
      create: { code: country.currency, name: country.currency, symbol: country.currency, decimals: 2, isCrypto: false },
      update: { name: country.currency },
    });

    await prisma.country.upsert({
      where: { iso2: country.iso2 },
      update: { name: country.name, dialCode: country.dialCode, isActive: true, currencyId: currency.id },
      create: {
        iso2: country.iso2,
        name: country.name,
        dialCode: country.dialCode,
        currency: { connect: { id: currency.id } },
      },
    });
  }));

  await Promise.all(methods.map((method) => prisma.paymentMethodRef.upsert({
    where: { code: method.code },
    update: { name: method.name, isActive: true },
    create: method,
  })));

  await Promise.all(providers.map(async (provider) => {
    const country = await prisma.country.findUnique({ where: { iso2: provider.country } });
    const method = await prisma.paymentMethodRef.findUnique({ where: { code: provider.method } });
    if (!country || !method) return;

    await prisma.paymentProvider.upsert({
      where: { providerCode: provider.providerCode },
      update: {
        name: provider.name,
        countryId: country.id,
        methodId: method.id,
        requiresType: provider.requiresType,
        isActive: true,
      },
      create: {
        providerCode: provider.providerCode,
        name: provider.name,
        countryId: country.id,
        methodId: method.id,
        requiresType: provider.requiresType,
      },
    });
  }));

  console.log('✅ Seed data inserted for NetwalletPay lookup tables');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
