/**
 * ZikoPay live test — mirrors exactly what zikopay.provider.ts now sends.
 * Run:  node --env-file=.env scripts/zikopay-live-test.mjs
 * Never prints API key/secret. Prints only request payload + ZikoPay response.
 */

const rawBase = process.env.ZIKOPAY_BASE_URL ?? 'https://api.payment.zikopay.com';
const baseUrl = rawBase.replace(/\/+$/, '').replace(/\/v1$/, '');
const apiKey = process.env.ZIKOPAY_API_KEY ?? '';
const apiSecret = process.env.ZIKOPAY_API_SECRET ?? '';
const webhookBase = process.env.NETWALLETPAY_WEBHOOK_BASE_URL ?? '';
const returnUrl = process.env.FRONTEND_APP_URL ?? 'https://tchokopay.com';

console.log('Base URL      :', baseUrl);
console.log('Credentials   :', apiKey && apiSecret ? `loaded (key len ${apiKey.length}, secret len ${apiSecret.length})` : 'MISSING');

const headers = {
  'X-API-Key': apiKey,
  'X-API-Secret': apiSecret,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const reference = `TEST-${Date.now()}`;
const payload = {
  amount: 200, // ZikoPay minimum is 200 XAF (100 was rejected)
  currency: 'XAF',
  phoneNumber: '237670287739',
  operator: 'mtn_cm',
  return_url: `${returnUrl}/dashboard`,
  cancel_url: `${returnUrl}/dashboard`,
  callback_url: `${webhookBase}/api/v1/webhooks/zikopay`,
  payment_details: { reference, order_id: reference },
  customer: { name: 'Brian', phone: '237670287739', email: 'ybrpcbrian@gmail.com' },
  description: `TchokoPay test ${reference}`,
};

const payinUrl = `${baseUrl}/v1/payments/payin/mobile-money`;
console.log('\nPOST', payinUrl);
console.log('Payload:', JSON.stringify(payload, null, 2));

const res = await fetch(payinUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = text; }

console.log(`\n← HTTP ${res.status}`);
console.log('Response:', typeof body === 'string' ? body : JSON.stringify(body, null, 2));

const txRef = body?.reference ?? body?.data?.reference;
if (txRef) {
  console.log(`\nReference: ${txRef} — approve the prompt on your phone, then we poll status.`);
} else {
  console.log('\nNo reference returned — see response above for the validation error.');
}
