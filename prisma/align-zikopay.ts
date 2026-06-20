/**
 * Targeted ZikoPay operator alignment — brings our provider rows exactly in
 * line with ZikoPay's documented 12 operators across 5 countries.
 * Idempotent & non-destructive: upserts the 12, soft-deactivates the rest.
 *
 * Run:  npx ts-node prisma/align-zikopay.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error('DIRECT_URL environment variable is not set');

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ZikoPay's documented operators. providerCode = 'ziko_' + their operator code
// (our provider strips the prefix to get the code it sends to the API).
const zikoPayProviders = [
  { providerCode: 'ziko_mtn_cm',        name: 'MTN MoMo',      country: 'CM' },
  { providerCode: 'ziko_orange_cm',     name: 'Orange Money',  country: 'CM' },
  { providerCode: 'ziko_mtn_ci',        name: 'MTN MoMo',      country: 'CI' },
  { providerCode: 'ziko_orange_ci',     name: 'Orange Money',  country: 'CI' },
  { providerCode: 'ziko_moov_ci',       name: 'Moov Money',    country: 'CI' },
  { providerCode: 'ziko_wave_ci',       name: 'Wave',          country: 'CI' },
  { providerCode: 'ziko_orange_sn',     name: 'Orange Money',  country: 'SN' },
  { providerCode: 'ziko_free_money_sn', name: 'Free Money',    country: 'SN' },
  { providerCode: 'ziko_expresso_sn',   name: 'Expresso',      country: 'SN' },
  { providerCode: 'ziko_mtn_bj',        name: 'MTN MoMo',      country: 'BJ' },
  { providerCode: 'ziko_moov_bj',       name: 'Moov Money',    country: 'BJ' },
  { providerCode: 'ziko_t_money_tg',    name: 'T-Money',       country: 'TG' },
];

async function main() {
  const aggregator = await prisma.paymentAggregator.findUnique({ where: { code: 'zikopay' } });
  if (!aggregator) throw new Error('zikopay aggregator not found');
  const method = await prisma.paymentMethodRef.findUnique({ where: { code: 'MOBILE_MONEY' } });
  if (!method) throw new Error('MOBILE_MONEY method not found');

  console.log('── BEFORE ──');
  const before = await prisma.paymentProvider.findMany({
    where: { aggregatorId: aggregator.id },
    include: { country: true },
    orderBy: { providerCode: 'asc' },
  });
  before.forEach((p) => console.log(`  ${p.isActive ? '●' : '○'} ${p.providerCode.padEnd(22)} ${p.country.iso2}  ${p.name}`));

  const codes: string[] = [];
  for (const { providerCode, name, country } of zikoPayProviders) {
    const countryRec = await prisma.country.findUnique({ where: { iso2: country } });
    if (!countryRec) { console.warn(`  ⚠ Skip ${providerCode} — country ${country} missing`); continue; }
    await prisma.paymentProvider.upsert({
      where: { providerCode },
      create: { providerCode, name, aggregatorId: aggregator.id, countryId: countryRec.id, methodId: method.id, requiresType: false },
      update: { name, aggregatorId: aggregator.id, countryId: countryRec.id, methodId: method.id, requiresType: false, isActive: true },
    });
    codes.push(providerCode);
  }

  const { count } = await prisma.paymentProvider.updateMany({
    where: { aggregatorId: aggregator.id, providerCode: { notIn: codes } },
    data: { isActive: false },
  });

  console.log(`\n✔ Upserted ${codes.length} ZikoPay providers; deactivated ${count} others.`);

  console.log('\n── AFTER (active only) ──');
  const after = await prisma.paymentProvider.findMany({
    where: { aggregatorId: aggregator.id, isActive: true },
    include: { country: true },
    orderBy: [{ country: { iso2: 'asc' } }, { providerCode: 'asc' }],
  });
  after.forEach((p) => console.log(`  ● ${p.providerCode.padEnd(22)} ${p.country.iso2}  → ${p.providerCode.replace(/^ziko_/, '')}`));
  console.log(`\nTotal active: ${after.length} (expected 12)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
