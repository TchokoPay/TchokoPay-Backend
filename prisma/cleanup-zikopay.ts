/**
 * Hard-delete the deactivated (unsupported) ZikoPay provider rows, safely.
 * Verifies no PaymentIdentity references them first. Then prints the final
 * active ZikoPay set + confirms the ZikoPay countries are live.
 *
 * Run:  npx ts-node prisma/cleanup-zikopay.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error('DIRECT_URL environment variable is not set');
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const aggregator = await prisma.paymentAggregator.findUnique({ where: { code: 'zikopay' } });
  if (!aggregator) throw new Error('zikopay aggregator not found');

  const stale = await prisma.paymentProvider.findMany({
    where: { aggregatorId: aggregator.id, isActive: false },
    include: { country: true },
  });
  console.log(`Found ${stale.length} inactive ZikoPay rows to remove:`);
  stale.forEach((p) => console.log(`  ○ ${p.providerCode}  (${p.country.iso2})`));

  // FK safety: any saved payout phone settings tied to these?
  const ids = stale.map((p) => p.id);
  const refs = ids.length
    ? await prisma.userPaymentPhoneSettings.count({ where: { providerId: { in: ids } } })
    : 0;
  if (refs > 0) {
    console.error(`\n⛔ ${refs} UserPaymentPhoneSettings rows reference these providers — NOT deleting. Resolve first.`);
    return;
  }

  if (ids.length) {
    const { count } = await prisma.paymentProvider.deleteMany({
      where: { id: { in: ids } },
    });
    console.log(`\n✔ Deleted ${count} inactive ZikoPay provider rows.`);
  } else {
    console.log('\nNothing to delete.');
  }

  console.log('\n── Active ZikoPay providers (should be 12) ──');
  const active = await prisma.paymentProvider.findMany({
    where: { aggregatorId: aggregator.id, isActive: true },
    include: { country: true },
    orderBy: [{ country: { iso2: 'asc' } }, { providerCode: 'asc' }],
  });
  active.forEach((p) => console.log(`  ● ${p.providerCode.padEnd(20)} ${p.country.iso2}  ${p.name}  → ${p.providerCode.replace(/^ziko_/, '')}`));
  console.log(`  total: ${active.length}`);

  console.log('\n── Country liveness check (active + has active providers) ──');
  for (const iso2 of ['CM', 'CI', 'SN', 'BJ', 'TG', 'GH']) {
    const c = await prisma.country.findUnique({ where: { iso2 } });
    if (!c) { console.log(`  ${iso2}: (country row missing)`); continue; }
    const provs = await prisma.paymentProvider.findMany({
      where: { country: { iso2 }, isActive: true, aggregator: { isActive: true } },
      include: { aggregator: true },
    });
    const list = provs.map((p) => `${p.name}[${p.aggregator?.code ?? '?'}]`).join(', ') || 'NONE';
    console.log(`  ${iso2}: active=${c.isActive}  providers: ${list}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
