/** NetwalletPay transaction status. Run: node --env-file=.env scripts/netwallet-status.mjs <TXID> */
const baseUrl = (process.env.NETWALLETPAY_BASE_URL ?? 'https://netwalletpay.com').replace(/\/+$/, '');
const form = new URLSearchParams();
form.append('primary_key', process.env.NETWALLETPAY_PRIMARY_KEY ?? '');
form.append('email', process.env.NETWALLETPAY_EMAIL ?? '');
form.append('grant_type', 'primary_key');
const tk = await fetch(`${baseUrl}/api/v1/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
const token = (await tk.json()).access_token;
const id = process.argv[2];
const res = await fetch(`${baseUrl}/api/v1/global/transaction-status/${id}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
const text = await res.text();
let body; try { body = JSON.parse(text); } catch { body = text; }
console.log(`GET /api/v1/global/transaction-status/${id}`);
console.log(`← HTTP ${res.status}`);
console.log(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
