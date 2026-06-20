/**
 * ZikoPay status poll — mirrors zikopay.provider.ts checkTransactionStatus.
 * Run:  node --env-file=.env scripts/zikopay-status.mjs <REFERENCE>
 */

const rawBase = process.env.ZIKOPAY_BASE_URL ?? 'https://api.payment.zikopay.com';
const baseUrl = rawBase.replace(/\/+$/, '').replace(/\/v1$/, '');
const headers = {
  'X-API-Key': process.env.ZIKOPAY_API_KEY ?? '',
  'X-API-Secret': process.env.ZIKOPAY_API_SECRET ?? '',
  Accept: 'application/json',
};

const ref = process.argv[2];
if (!ref) {
  console.error('Usage: node --env-file=.env scripts/zikopay-status.mjs <REFERENCE>');
  process.exit(1);
}

const url = `${baseUrl}/v1/payment/status/${ref}`;
console.log('GET', url, '\n');

const res = await fetch(url, { headers });
const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = text; }

console.log(`← HTTP ${res.status}`);
console.log('Response:', typeof body === 'string' ? body : JSON.stringify(body, null, 2));
console.log('\nResolved status:', body?.data?.status ?? '(not found at data.status)');
