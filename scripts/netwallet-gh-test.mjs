/**
 * Live NetwalletPay Ghana collection (payin) test — mirrors NetwalletpayProvider.payin.
 * 10 GHS to +233 020 564 9687 via netwallet_gh. Prints request + response. No DB writes.
 *
 * Run:  node --env-file=.env scripts/netwallet-gh-test.mjs
 */
import { createHash } from 'node:crypto';

const baseUrl = (process.env.NETWALLETPAY_BASE_URL ?? 'https://netwalletpay.com').replace(/\/+$/, '');
const primaryKey = process.env.NETWALLETPAY_PRIMARY_KEY ?? '';
const secondaryKey = process.env.NETWALLETPAY_SECONDARY_KEY ?? '';
const email = process.env.NETWALLETPAY_EMAIL ?? '';
const webhookBase = process.env.NETWALLETPAY_WEBHOOK_BASE_URL ?? '';

console.log('Base URL    :', baseUrl);
console.log('Credentials :', primaryKey && secondaryKey && email ? `loaded (primary ${primaryKey.length}, secondary ${secondaryKey.length})` : 'MISSING');

async function getToken() {
  const form = new URLSearchParams();
  form.append('primary_key', primaryKey);
  form.append('email', email);
  form.append('grant_type', 'primary_key');
  const res = await fetch(`${baseUrl}/api/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Token failed ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

// +2330205649687 -> drop the trailing-leading 0 of the local part -> 233205649687
function formatGhanaPhone(raw) {
  let d = raw.replace(/[\s+\-()]/g, '');
  if (d.startsWith('233')) d = '233' + d.slice(3).replace(/^0+/, '');
  return d;
}

const orderId = `TESTGH${Date.now()}`;
const hash = createHash('sha256').update(`${orderId}_${secondaryKey}`).digest('hex');
const phone = process.argv[2] ?? formatGhanaPhone('+2330205649687');

const payload = {
  CurrencyCode: 'GHS',
  OrderID: orderId,
  Amount: 10,
  Method: 'MOBILE_MONEY',
  CountryCode: 'GH',
  MethodProvider: 'netwallet_gh',
  PhoneNumber: phone,
  Description: `TchokoPay GH test ${orderId}`,
  CallbackUrl: `${webhookBase}/api/v1/webhooks/netwalletpay`,
  Hash: hash,
};

const token = await getToken();
console.log('Token       : obtained');
console.log('\nPhone       :', '+2330205649687', '->', phone);
console.log('POST', `${baseUrl}/api/v1/global/collection/request-payment`);
console.log('Payload:', JSON.stringify(payload, null, 2));

const res = await fetch(`${baseUrl}/api/v1/global/collection/request-payment`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(payload),
});
const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = text; }

console.log(`\n← HTTP ${res.status}`);
console.log('Response:', typeof body === 'string' ? body : JSON.stringify(body, null, 2));
const txId = body?.data;
if (res.ok && txId) console.log(`\nTransactionId: ${txId} — a 10 GHS prompt should reach the phone.`);
else console.log('\nNo transaction id — see response above.');
