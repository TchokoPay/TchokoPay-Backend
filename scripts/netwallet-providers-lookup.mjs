/**
 * Live NetwalletPay provider lookup — read-only. Authenticates, then queries
 * GET /api/v1/lookup/get-providers/{COLLECTION|PAYOUT}/MOBILE_MONEY/{country}
 * for every supported country. Prints provider codes. Writes nothing.
 *
 * Run:  node --env-file=.env scripts/netwallet-providers-lookup.mjs
 */

const baseUrl = (process.env.NETWALLETPAY_BASE_URL ?? 'https://netwalletpay.com').replace(/\/+$/, '');
const primaryKey = process.env.NETWALLETPAY_PRIMARY_KEY ?? '';
const email = process.env.NETWALLETPAY_EMAIL ?? '';

console.log('Base URL    :', baseUrl);
console.log('Credentials :', primaryKey && email ? `loaded (key len ${primaryKey.length}, email ${email})` : 'MISSING');

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
  const data = await res.json();
  return data.access_token;
}

async function lookup(token, paymentType, country, method = 'MOBILE_MONEY') {
  const url = `${baseUrl}/api/v1/lookup/get-providers/${paymentType}/${method}/${country}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) return { error: `HTTP ${res.status}`, body };
  return { data: body?.data ?? body };
}

const countries = ['CM', 'KE', 'TZ', 'UG', 'GH', 'RW', 'ZM', 'BI', 'EG'];

const token = await getToken();
console.log('Token       : obtained\n');

for (const c of countries) {
  console.log(`\n══ ${c} ══`);
  for (const pt of ['COLLECTION', 'PAYOUT']) {
    const r = await lookup(token, pt, c);
    if (r.error) {
      console.log(`  ${pt.padEnd(10)} ${r.error}  ${typeof r.body === 'string' ? r.body.slice(0, 80) : JSON.stringify(r.body).slice(0, 120)}`);
    } else if (Array.isArray(r.data) && r.data.length) {
      console.log(`  ${pt}:`);
      r.data.forEach((p) => console.log(`     ${String(p.id).padEnd(16)} ${String(p.name).padEnd(22)} ${p.transactionCurrency ?? ''}`));
    } else {
      console.log(`  ${pt.padEnd(10)} (no providers)`);
    }
  }
}
